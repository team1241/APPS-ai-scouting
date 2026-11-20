"use client";

import { Button, Card, EmptyState, FieldError, Input, Label, TextField } from "@heroui/react";
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
import { DialogActions, FormDialog } from "@/components/form-dialog";
import { useEditedErrors } from "@/lib/use-edited-errors";

export interface ApiKey {
  id: string;
  name: string;
  start: string;
  secret: string;
  rateLimitPerMinute: number;
  createdAt: string;
}

// A full-width divider between a card's header and its body.
const cardDivider = "-mx-5 border-t border-separator sm:-mx-6";

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
    <li className="space-y-3 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 font-semibold break-words">{apiKey.name}</p>
        <p className="text-sm text-muted">
          Created{" "}
          <time dateTime={apiKey.createdAt}>{dateFormat.format(new Date(apiKey.createdAt))}</time>
          {" · "}
          {apiKey.rateLimitPerMinute} requests per minute
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-h-11 min-w-0 flex-1 basis-64 rounded-xl bg-default px-3.5 py-2.5 font-mono text-[0.8125rem] leading-6 break-all select-all">
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
        <Button variant="secondary" aria-pressed={shown} onPress={() => setShown(!shown)}>
          {shown ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
          {shown ? "Hide" : "Show"}
        </Button>
        <Button variant="secondary" className="min-w-24" onPress={copy}>
          {copied === "copied" ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
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
      <p aria-live="polite" className="text-sm font-medium text-danger empty:hidden">
        {copied === "failed" ? "Copy failed. Select the key and copy it yourself." : ""}
      </p>
    </li>
  );
}

// The dialog unmounts this form when it closes, so each open starts with an
// empty name and no error.
function CreateKeyForm({
  organizationId,
  onCreated,
  onPendingChange,
  onCancel,
}: {
  organizationId: string;
  onCreated: (id: string) => void;
  onPendingChange: (pending: boolean) => void;
  onCancel: () => void;
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
  const { edit, shown } = useEditedErrors<"name">(state);
  const error = shown("name", state.status === "error" ? state.message : undefined);
  return (
    <form action={submit} className="grid gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <TextField
        key={state.status}
        name="name"
        isRequired
        maxLength={60}
        autoComplete="off"
        defaultValue={state.name}
        isDisabled={pending}
        isInvalid={Boolean(error)}
        onChange={() => edit("name")}
        fullWidth
      >
        <Label>Key name</Label>
        <Input ref={input} placeholder="For example, Strategy website" />
        <FieldError>{error}</FieldError>
      </TextField>
      <DialogActions>
        <Button variant="tertiary" isDisabled={pending} onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isPending={pending}>
          {pending ? "Creating…" : "Create key"}
        </Button>
      </DialogActions>
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
    <>
      <Button onPress={() => setOpen(true)}>
        <Plus aria-hidden="true" className="size-4" />
        Create key
      </Button>
      <FormDialog
        isOpen={open}
        onOpenChange={setOpen}
        isPending={pending}
        title="Create API key"
        description="Use one key for each integration. To replace a key, create a new one, update the integration, then revoke the old key."
        icon={<KeyRound aria-hidden="true" className="size-5" />}
      >
        <CreateKeyForm
          organizationId={organizationId}
          onCreated={created}
          onPendingChange={setPending}
          onCancel={() => setOpen(false)}
        />
      </FormDialog>
    </>
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
    <Card aria-labelledby="api-keys-title" render={(props) => <section {...props} />}>
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-64">
          <Card.Title id="api-keys-title" render={(props) => <h2 {...props} />}>
            API keys
          </Card.Title>
          <Card.Description className="mt-1">
            Keys give read-only access to this team’s scouting data. Every admin of this team can
            view, copy and revoke them.
          </Card.Description>
        </div>
        {keys?.length ? createDialog : null}
      </Card.Header>
      {keys === null ? (
        <Card.Footer className={`${cardDivider} flex-wrap justify-between gap-3 px-5 pt-4 sm:px-6`}>
          <p className="text-sm">We couldn’t load your API keys.</p>
          <Button variant="outline" onPress={() => router.refresh()}>
            Check again
          </Button>
        </Card.Footer>
      ) : keys.length ? (
        <ul className={`${cardDivider} -mb-5 divide-y divide-separator sm:-mb-6`}>
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
        <EmptyState
          className={`${cardDivider} flex flex-col items-center gap-3 px-6 pt-10 pb-4 text-center md:pt-12`}
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
            <KeyRound aria-hidden="true" className="size-6" />
          </span>
          <h3 className="text-base font-semibold">No API keys yet</h3>
          <p className="max-w-sm text-sm text-pretty text-muted">
            Create a key for each integration that reads this team’s scouting data, such as a
            strategy website or a pick list spreadsheet.
          </p>
          <div className="mt-2">{createDialog}</div>
        </EmptyState>
      )}
    </Card>
  );
}
