"use client";

import { Button } from "@heroui/react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  revealTeamApiKey,
  revokeTeamApiKey,
  type TeamChangeState,
} from "@/app/operator/teams/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import type { DirectoryTeamDetail } from "@/lib/operator";

type Key = DirectoryTeamDetail["keys"][number];

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

// The value is fetched only when the operator selects Show or Copy, and
// dropped again on Hide, so it is never part of the page payload.
function ActiveKey({
  organizationId,
  teamNumber,
  apiKey,
}: {
  organizationId: string;
  teamNumber: number;
  apiKey: Key;
}) {
  const [revokeState, revoke, revoking] = useActionState<TeamChangeState, FormData>(
    revokeTeamApiKey,
    {},
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState<"show" | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function value(action: "show" | "copy") {
    if (secret) return secret;
    setBusy(action);
    setError(null);
    const result = await revealTeamApiKey(organizationId, apiKey.id).catch(() => ({
      error: "We couldn’t reach the server. Try again shortly.",
    }));
    setBusy(null);
    if ("error" in result) {
      setError(result.error);
      return null;
    }
    setSecret(result.secret);
    return result.secret;
  }

  async function toggle() {
    if (shown) {
      setShown(false);
      setSecret(null);
      return;
    }
    if (await value("show")) setShown(true);
  }

  async function copy() {
    const text = await value("copy");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setShown(true);
      setError("Copy failed. Select the key and copy it yourself.");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-h-11 min-w-0 flex-1 basis-64 rounded-xl bg-surface-secondary px-3.5 py-2.5 font-mono text-[0.8125rem] leading-6 break-all text-foreground select-all">
          {shown && secret ? (
            secret
          ) : (
            <>
              <span className="sr-only">Hidden key starting </span>
              {apiKey.start}
              <span aria-hidden="true">{"•".repeat(16)}</span>
            </>
          )}
        </code>
        <Button
          variant="secondary"
          className="min-w-24"
          aria-pressed={shown}
          isDisabled={busy !== null}
          onPress={toggle}
        >
          {shown ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
          {busy === "show" ? "Showing…" : shown ? "Hide" : "Show"}
        </Button>
        <Button variant="secondary" className="min-w-24" isDisabled={busy !== null} onPress={copy}>
          {copied ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
          {busy === "copy" ? "Copying…" : copied ? "Copied" : "Copy"}
        </Button>
        <ConfirmDialog
          trigger="Revoke"
          title={`Revoke “${apiKey.name}” for Team ${teamNumber}?`}
          description="The team’s integrations that use this key stop working at once. The team’s admins are not notified. You cannot undo this."
          confirmLabel="Revoke key"
          pendingLabel="Revoking…"
          cancelLabel="Keep key"
          action={revoke}
          pending={revoking}
          error={revokeState.error}
          fields={{ organizationId, keyId: apiKey.id }}
        />
      </div>
      <p aria-live="polite" className="text-sm font-medium text-danger empty:hidden">
        {error ?? ""}
      </p>
    </>
  );
}

export function OperatorTeamKeys({
  organizationId,
  teamNumber,
  keys,
}: {
  organizationId: string;
  teamNumber: number;
  keys: Key[];
}) {
  return (
    <section className="rounded-2xl bg-surface shadow-surface" aria-labelledby="keys-title">
      <div className="p-5 sm:p-6">
        <h2 id="keys-title" className="text-[1.0625rem] font-semibold text-foreground">
          API keys
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Keys give read-only access to this team’s scouting data. Values stay hidden until you
          select Show or Copy. Only the team’s admins can create keys. You can revoke any key.
        </p>
      </div>
      {keys.length ? (
        <ul className="divide-y divide-separator border-t border-separator">
          {keys.map((key) => (
            <li key={key.id} className="space-y-3 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 font-semibold break-words">{key.name}</p>
                {key.revokedAt ? (
                  <StatusBadge tone="neutral">Revoked</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Active</StatusBadge>
                )}
              </div>
              <p className="text-sm text-muted">
                Created{" "}
                <time dateTime={key.createdAt}>{dateFormat.format(new Date(key.createdAt))}</time>
                {" · "}
                {key.rateLimitPerMinute} requests per minute
                {key.revokedAt ? (
                  <>
                    {" · "}Revoked{" "}
                    <time dateTime={key.revokedAt}>
                      {dateFormat.format(new Date(key.revokedAt))}
                    </time>
                  </>
                ) : null}
              </p>
              {key.revokedAt ? (
                <p className="text-sm text-muted">
                  Started <code className="font-mono">{key.start}</code>. Its value was erased when
                  it was revoked and can’t be shown.
                </p>
              ) : (
                <ActiveKey organizationId={organizationId} teamNumber={teamNumber} apiKey={key} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-separator px-5 py-4 text-sm text-muted sm:px-6">
          This team has no API keys.
        </p>
      )}
    </section>
  );
}
