"use client";

import { Check, ExternalLink, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useState } from "react";
import { telegramAction, telegramConnected } from "@/app/admin/telegram-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

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
          done ? "bg-success-soft text-success" : "bg-accent text-primary",
        )}
      >
        {done ? <Check className="size-4" strokeWidth={2.5} /> : number}
      </span>
      <div className="min-w-0 space-y-3 pt-1">
        <p className="font-medium">
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

  return (
    <section className="rounded-xl border bg-card" aria-labelledby="telegram-title">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-6">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="telegram-title" className="text-lg font-semibold">
            Telegram
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {connected === null
              ? "We couldn’t check your Telegram connection."
              : connected
                ? "Your account administers this team in Telegram. Use /invite there to invite scouts."
                : "Connect your Telegram account to administer this team and invite scouts."}
          </p>
        </div>
        <div aria-live="polite">{status}</div>
      </div>

      {connected === null ? (
        <div className="border-t px-6 py-4">
          <Button type="button" variant="outline" className="h-11" onClick={() => router.refresh()}>
            Check again
          </Button>
        </div>
      ) : connected ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t py-3 pr-3 pl-6">
          <p className="text-sm text-muted-foreground">
            {connectedAt ? (
              <>
                Connected{" "}
                <time dateTime={connectedAt}>{dateFormat.format(new Date(connectedAt))}</time>
              </>
            ) : (
              "Connected"
            )}
          </p>
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
      ) : (
        <ol className="space-y-6 border-t p-6">
          <Step number={1} done={linkOpen} title="Create a one-time link">
            <form action={action}>
              <input type="hidden" name="organizationId" value={organizationId} />
              <Button
                type="submit"
                variant={linkOpen ? "outline" : "default"}
                disabled={pending}
                className="h-11 px-5"
              >
                {pending ? "Creating link…" : link ? "Create a new link" : "Create link"}
              </Button>
            </form>
            {state.error ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
          </Step>
          <Step number={2} done={false} title="Open it in Telegram and tap Start">
            {linkOpen && link?.url ? (
              <>
                <Button asChild className="h-11 px-5">
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    Open Telegram
                    <ExternalLink aria-hidden="true" className="size-4" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </Button>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 shrink-0 motion-safe:animate-spin"
                  />
                  <span>
                    This page updates when you confirm. The link expires in{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {Math.floor((secondsLeft ?? 0) / 60)}:
                      {String((secondsLeft ?? 0) % 60).padStart(2, "0")}
                    </span>{" "}
                    and works once.
                  </span>
                </p>
              </>
            ) : expired ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                This link expired. Create a new link to try again.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                The link opens our bot in Telegram. It expires after 10 minutes.
              </p>
            )}
          </Step>
        </ol>
      )}
    </section>
  );
}
