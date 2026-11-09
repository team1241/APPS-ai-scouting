"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  revealTeamApiKey,
  revokeTeamApiKey,
  type TeamChangeState,
} from "@/app/operator/teams/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
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
        <code className="min-h-11 min-w-0 flex-1 basis-64 rounded-md border bg-muted/50 px-3 py-2.5 font-mono text-sm break-all select-all">
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
          type="button"
          variant="outline"
          className="h-11 min-w-24"
          aria-pressed={shown}
          disabled={busy !== null}
          onClick={toggle}
        >
          {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {busy === "show" ? "Showing…" : shown ? "Hide" : "Show"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-24"
          disabled={busy !== null}
          onClick={copy}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
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
      <p aria-live="polite" className="text-sm text-destructive empty:hidden">
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
    <section className="rounded-xl border bg-card" aria-labelledby="keys-title">
      <div className="p-6">
        <h2 id="keys-title" className="text-lg font-semibold">
          API keys
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Keys give read-only access to this team’s scouting data. Values stay hidden until you
          select Show or Copy. Only the team’s admins can create keys. You can revoke any key.
        </p>
      </div>
      {keys.length ? (
        <ul className="divide-y border-t">
          {keys.map((key) => (
            <li key={key.id} className="space-y-3 px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 font-medium break-words">{key.name}</p>
                {key.revokedAt ? (
                  <StatusBadge tone="neutral">Revoked</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Active</StatusBadge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
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
                <p className="text-sm text-muted-foreground">
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
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          This team has no API keys.
        </p>
      )}
    </section>
  );
}
