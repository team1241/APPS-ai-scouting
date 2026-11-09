"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  addOperator,
  cancelOperatorInvitation,
  type InvitationState,
  type OperatorFormState,
  type RemoveState,
  removeOperator,
  resendOperatorInvitation,
} from "@/app/operator/operators/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialForm: OperatorFormState = {
  status: "idle",
  errors: {},
  values: { name: "", email: "" },
};

export function AddOperatorForm() {
  const [state, submit, pending] = useActionState(addOperator, initialForm);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    const first = form.current?.querySelector<HTMLInputElement>("[aria-invalid=true]");
    first?.focus();
  }, [state]);
  const field = (name: "name" | "email", label: string, type: string, hint?: string) => {
    const error = state.errors[name];
    return (
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor={`operator-${name}`}>{label}</Label>
        <Input
          id={`operator-${name}`}
          name={name}
          type={type}
          required
          maxLength={name === "name" ? 120 : 254}
          autoComplete="off"
          defaultValue={state.values[name]}
          key={`${name}-${state.status}-${state.values[name]}`}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? `operator-${name}-error` : hint ? `operator-${name}-hint` : undefined
          }
          className="h-11"
        />
        {error ? (
          <p id={`operator-${name}-error`} className="text-sm text-destructive">
            {error}
          </p>
        ) : hint ? (
          <p id={`operator-${name}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <form ref={form} action={submit} className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {field("name", "Name", "text")}
        {field(
          "email",
          "Email",
          "email",
          "If they have no account yet, we email them an invitation.",
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {pending ? "Adding…" : "Add or invite"}
        </Button>
        {state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={
              state.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

// Removal is confirmed in place; there is no modal.
export function RemoveOperator({ clerkUserId, name }: { clerkUserId: string; name: string }) {
  const [state, remove, removing] = useActionState<RemoveState, FormData>(removeOperator, {
    status: "idle",
  });
  const [confirming, setConfirming] = useState(false);
  return (
    <form action={remove} className="flex flex-wrap items-center gap-2 sm:justify-end">
      <input type="hidden" name="clerkUserId" value={clerkUserId} />
      {confirming ? (
        <>
          <span className="text-sm">Remove {name}?</span>
          <Button type="submit" variant="destructive" disabled={removing} className="h-11">
            {removing ? "Removing…" : "Confirm remove"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={removing}
            className="h-11"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-destructive hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          Remove
        </Button>
      )}
      {state.status === "error" ? (
        <p role="alert" className="w-full text-sm text-destructive sm:text-right">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

// Resend and cancel for an open operator invitation. Cancel is confirmed in a dialog.
export function InvitationActions({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const [resent, resend, resending] = useActionState<InvitationState, FormData>(
    resendOperatorInvitation,
    { status: "idle" },
  );
  const [cancelled, cancel, cancelling] = useActionState<InvitationState, FormData>(
    cancelOperatorInvitation,
    { status: "idle" },
  );
  const busy = resending || cancelling;
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <form action={resend}>
          <input type="hidden" name="invitationId" value={invitationId} />
          <Button type="submit" variant="outline" disabled={busy} className="h-11">
            {resending ? "Sending…" : "Resend"}
          </Button>
        </form>
        <ConfirmDialog
          trigger="Cancel invitation"
          title="Cancel this invitation?"
          description={
            <>
              The link sent to <span className="font-medium text-foreground">{email}</span> stops
              working. You can invite them again later.
            </>
          }
          confirmLabel="Cancel invitation"
          pendingLabel="Cancelling…"
          cancelLabel="Keep invitation"
          action={cancel}
          pending={cancelling}
          error={cancelled.status === "error" ? cancelled.message : undefined}
          disabled={busy}
          fields={{ invitationId }}
        />
      </div>
      {resent.status !== "idle" && resent.message ? (
        <p
          role={resent.status === "error" ? "alert" : "status"}
          className={
            resent.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {resent.message}
        </p>
      ) : null}
    </div>
  );
}
