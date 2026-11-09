"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import {
  type ApiKeyFormState,
  createApiKey,
  type RevokeKeyState,
  revokeApiKey,
} from "@/app/admin/api-key-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ApiKey {
  id: string;
  name: string;
  start: string;
  secret: string;
  rateLimitPerMinute: number;
  createdAt: string;
}

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

function KeyRow({
  organizationId,
  apiKey,
  initiallyShown,
}: {
  organizationId: string;
  apiKey: ApiKey;
  initiallyShown: boolean;
}) {
  // A key just created by this admin starts shown, so it is ready to copy.
  const [toggled, setShown] = useState<boolean | null>(null);
  const shown = toggled ?? initiallyShown;
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const [state, revoke, revoking] = useActionState<RevokeKeyState, FormData>(revokeApiKey, {});
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.secret);
      setCopied("copied");
    } catch {
      setShown(true);
      setCopied("failed");
    }
  };
  return (
    <li className="space-y-3 px-6 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 font-medium break-words">{apiKey.name}</p>
        <p className="text-sm text-muted-foreground">
          Created{" "}
          <time dateTime={apiKey.createdAt}>{dateFormat.format(new Date(apiKey.createdAt))}</time>
          {" · "}
          {apiKey.rateLimitPerMinute} requests per minute
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-h-11 min-w-0 flex-1 basis-64 rounded-md border bg-muted/50 px-3 py-2.5 font-mono text-sm break-all select-all">
          {shown ? (
            apiKey.secret
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
          className="h-11"
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {shown ? "Hide" : "Show"}
        </Button>
        <Button type="button" variant="outline" className="h-11 min-w-24" onClick={copy}>
          {copied === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied === "copied" ? "Copied" : "Copy"}
        </Button>
        <ConfirmDialog
          trigger="Revoke"
          title={`Revoke “${apiKey.name}”?`}
          description="Integrations that use this key stop working at once. You cannot undo this."
          confirmLabel="Revoke key"
          pendingLabel="Revoking…"
          cancelLabel="Keep key"
          action={revoke}
          pending={revoking}
          error={state.error}
          fields={{ organizationId, keyId: apiKey.id }}
        />
      </div>
      <p aria-live="polite" className="text-sm text-destructive empty:hidden">
        {copied === "failed" ? "Copy failed. Select the key and copy it yourself." : ""}
      </p>
    </li>
  );
}

// Radix unmounts this form when the dialog closes, so each open starts with an
// empty name and no error.
function CreateKeyForm({
  organizationId,
  onCreated,
  onPendingChange,
}: {
  organizationId: string;
  onCreated: (id: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, submit, pending] = useActionState<ApiKeyFormState, FormData>(createApiKey, {
    status: "idle",
    name: "",
  });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  useEffect(() => {
    if (state.status === "error") input.current?.focus();
    if (state.createdId) onCreated(state.createdId);
  }, [state, onCreated]);
  const error = state.status === "error" ? state.message : undefined;
  return (
    <form action={submit} className="grid gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <DialogHeader>
        <DialogTitle>Create API key</DialogTitle>
        <DialogDescription>
          Use one key for each integration. To replace a key, create a new one, update the
          integration, then revoke the old key.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="api-key-name">Key name</Label>
        <Input
          ref={input}
          id="api-key-name"
          name="name"
          required
          maxLength={60}
          autoComplete="off"
          placeholder="For example, Strategy website"
          defaultValue={state.name}
          key={state.status}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "api-key-name-error" : undefined}
          className="h-11"
        />
        {error ? (
          <p id="api-key-name-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending} className="h-11">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {pending ? "Creating…" : "Create key"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CreateKeyDialog({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const created = useCallback(
    (id: string) => {
      onCreated(id);
      setOpen(false);
    },
    [onCreated],
  );
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? null : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" className="h-11 px-5">
          <Plus aria-hidden="true" />
          Create key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <CreateKeyForm
          organizationId={organizationId}
          onCreated={created}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeys({
  organizationId,
  keys,
}: {
  organizationId: string;
  keys: ApiKey[] | null;
}) {
  const router = useRouter();
  const [createdId, setCreatedId] = useState<string | null>(null);
  // In the header when keys exist; in the empty state otherwise.
  const createDialog = <CreateKeyDialog organizationId={organizationId} onCreated={setCreatedId} />;
  return (
    <section className="rounded-xl border bg-card" aria-labelledby="api-keys-title">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-6">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="api-keys-title" className="text-lg font-semibold">
            API keys
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keys give read-only access to this team’s scouting data. Every admin of this team can
            view, copy and revoke them.
          </p>
        </div>
        {keys?.length ? createDialog : null}
      </div>
      {keys === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm">We couldn’t load your API keys.</p>
          <Button type="button" variant="outline" className="h-11" onClick={() => router.refresh()}>
            Check again
          </Button>
        </div>
      ) : keys.length ? (
        <ul className="divide-y border-t">
          {keys.map((key) => (
            <KeyRow
              key={key.id}
              organizationId={organizationId}
              apiKey={key}
              initiallyShown={key.id === createdId}
            />
          ))}
        </ul>
      ) : (
        <Empty className="rounded-none border-t border-solid px-6 py-10 md:py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-accent text-primary">
              <KeyRound aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h3>No API keys yet</h3>
            </EmptyTitle>
            <EmptyDescription>
              Create a key for each integration that reads this team’s scouting data, such as a
              strategy website or a pick list spreadsheet.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{createDialog}</EmptyContent>
        </Empty>
      )}
    </section>
  );
}
