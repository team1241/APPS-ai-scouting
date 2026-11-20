"use client";

import { Button, buttonVariants, Card } from "@heroui/react";
import { Check, ExternalLink, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useState } from "react";
import { telegramAction, telegramConnected } from "@/app/admin/telegram-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

// A full-width divider between a card's header and its body.
const cardDivider = "-mx-5 border-t border-separator px-5 pt-4 sm:-mx-6 sm:px-6";

// Seconds left until `expiresAt`, ticking once a second. Null without a link.
function useSecondsLeft(expiresAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

function Step({
  number,
  done,
  title,
  children,
}: {
  number: number;
  done: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
          done ? "bg-success text-success-foreground" : "bg-accent text-accent-foreground",
        )}
      >
        {done ? <Check className="size-4" strokeWidth={2.5} /> : number}
      </span>
      <div className="min-w-0 space-y-3 pt-1">
        <p className="font-semibold">
          {title}
          {done ? <span className="sr-only"> (done)</span> : null}
        </p>
        {children}
      </div>
    </li>
  );
}

export function TelegramConnection({
  organizationId,
  connected,
  connectedAt,
}: {
  organizationId: string;
  connected: boolean | null;
  connectedAt: string | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(telegramAction, {});
  const link = !connected && state.url && state.expiresAt ? state : null;
  const secondsLeft = useSecondsLeft(link?.expiresAt);
  const expired = secondsLeft === 0;
  const linkOpen = Boolean(link && !expired);

  // Watch for the confirmation in Telegram, then reload the server state.
  useEffect(() => {
    if (!linkOpen) return;
    let active = true;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      if ((await telegramConnected(organizationId)) && active) {
        clearInterval(timer);
        router.refresh();
      }
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [linkOpen, organizationId, router]);

  const status =
    connected === null ? (
      <StatusBadge tone="warning">Status unavailable</StatusBadge>
    ) : connected ? (
      <StatusBadge tone="success">Connected</StatusBadge>
    ) : linkOpen ? (
      <StatusBadge tone="waiting">Waiting for Telegram</StatusBadge>
    ) : (
      <StatusBadge tone="neutral">Not connected</StatusBadge>
    );

  const connectedLine = connectedAt ? (
    <>
      Connected <time dateTime={connectedAt}>{dateFormat.format(new Date(connectedAt))}</time>.
    </>
  ) : (
    "Connected."
  );

  return (
    <Card aria-labelledby="telegram-title" render={(props) => <section {...props} />}>
      {/* Title and state on one line; the action sits on the right so the card stays short. */}
      <Card.Header className="flex-row flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Card.Title id="telegram-title" render={(props) => <h2 {...props} />}>
              Telegram
            </Card.Title>
            <div aria-live="polite">{status}</div>
          </div>
          <Card.Description className="mt-1">
            {connected === null ? (
              "We couldn’t check your Telegram connection."
            ) : connected ? (
              <>
                {connectedLine} Your account administers this team in Telegram. Use /invite there to
                invite scouts.
              </>
            ) : (
              "Connect your Telegram account to administer this team and invite scouts."
            )}
          </Card.Description>
        </div>
        {connected === null ? (
          <Button variant="outline" onPress={() => router.refresh()}>
            Check again
          </Button>
        ) : connected ? (
          <div className="max-sm:-mb-2 max-sm:-ml-4 sm:-mr-2">
            <ConfirmDialog
              trigger="Disconnect"
              title="Disconnect Telegram?"
              description="Your Telegram account will lose access to this team. You can connect it again here."
              confirmLabel="Disconnect Telegram"
              pendingLabel="Disconnecting…"
              action={action}
              pending={pending}
              error={state.error}
              fields={{ organizationId, action: "disconnect" }}
            />
          </div>
        ) : null}
      </Card.Header>

      {connected !== false ? null : (
        <Card.Content className={cn(cardDivider, "pt-5")}>
          <ol className="space-y-6">
            <Step number={1} done={linkOpen} title="Create a one-time link">
              <form action={action}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <Button
                  type="submit"
                  variant={linkOpen ? "outline" : "primary"}
                  isPending={pending}
                >
                  {pending ? "Creating link…" : link ? "Create a new link" : "Create link"}
                </Button>
              </form>
              {state.error ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  {state.error}
                </p>
              ) : null}
            </Step>
            <Step number={2} done={false} title="Open it in Telegram and tap Start">
              {linkOpen && link?.url ? (
                <>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "primary" }), "gap-2")}
                  >
                    Open Telegram
                    <ExternalLink aria-hidden="true" className="size-4" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-4 shrink-0 motion-safe:animate-spin"
                    />
                    <span>
                      This page updates when you confirm. The link expires in{" "}
                      <span className="font-semibold text-foreground tabular-nums">
                        {Math.floor((secondsLeft ?? 0) / 60)}:
                        {String((secondsLeft ?? 0) % 60).padStart(2, "0")}
                      </span>{" "}
                      and works once.
                    </span>
                  </p>
                </>
              ) : expired ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  This link expired. Create a new link to try again.
                </p>
              ) : (
                <p className="text-sm text-muted">
                  The link opens our bot in Telegram. It expires after 10 minutes.
                </p>
              )}
            </Step>
          </ol>
        </Card.Content>
      )}
    </Card>
  );
}
