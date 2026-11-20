"use client";

import { Button, FieldError, Input, Label, TextField } from "@heroui/react";
import { UserPlus } from "lucide-react";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
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
import { DialogActions, FormDialog } from "@/components/form-dialog";
import { useEditedErrors } from "@/lib/use-edited-errors";

const initialForm: OperatorFormState = {
  status: "idle",
  errors: {},
  values: { name: "", email: "" },
};

// The modal unmounts this form when it closes, so each open starts empty.
function AddOperatorForm({
  onDone,
  onCancel,
  onPendingChange,
}: {
  onDone: (message: string) => void;
  onCancel: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, submit, pending] = useActionState(addOperator, initialForm);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  useEffect(() => {
    if (state.status === "done" && state.message) onDone(state.message);
    if (state.status === "error")
      form.current?.querySelector<HTMLInputElement>("[aria-invalid=true]")?.focus();
  }, [state, onDone]);
  const { edit, shown } = useEditedErrors<"name" | "email">(state);
  const field = (name: "name" | "email", label: string, type: string) => {
    const error = shown(name, state.errors[name]);
    return (
      <TextField
        key={`${name}-${state.status}-${state.values[name]}`}
        name={name}
        type={type}
        isRequired
        maxLength={name === "name" ? 120 : 254}
        autoComplete="off"
        defaultValue={state.values[name]}
        isDisabled={pending}
        isInvalid={error ? true : undefined}
        onChange={() => edit(name)}
        validationBehavior="aria"
        fullWidth
      >
        <Label>{label}</Label>
        <Input />
        <FieldError>{error}</FieldError>
      </TextField>
    );
  };
  return (
    <form ref={form} action={submit} className="grid gap-4">
      {field("name", "Name", "text")}
      {field("email", "Email", "email")}
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.message}
        </p>
      ) : null}
      <DialogActions>
        <Button variant="tertiary" isDisabled={pending} onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isPending={pending} className="px-5">
          {pending ? "Adding…" : "Add or invite"}
        </Button>
      </DialogActions>
    </form>
  );
}

// The current operators heading with the Add operator dialog and its outcome.
export function CurrentOperatorsHeading({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const done = useCallback((message: string) => {
    setNotice(message);
    setOpen(false);
  }, []);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2 id="current-heading" className="font-display text-xl text-foreground">
          Current operators <span className="tabular-nums">({count})</span>
        </h2>
        <Button className="px-5" onPress={() => setOpen(true)}>
          <UserPlus aria-hidden="true" className="size-4" />
          Add operator
        </Button>
        <FormDialog
          isOpen={open}
          onOpenChange={setOpen}
          isPending={pending}
          title="Add operator"
          description="People with an account become operators right away. Anyone else gets an email invitation that expires in 7 days."
          icon={<UserPlus aria-hidden="true" className="size-5" />}
        >
          <AddOperatorForm
            onDone={done}
            onCancel={() => setOpen(false)}
            onPendingChange={setPending}
          />
        </FormDialog>
      </div>
      <p role="status" className="text-sm font-medium text-success-soft-foreground empty:hidden">
        {notice}
      </p>
    </div>
  );
}

// Removal is confirmed in a dialog.
export function RemoveOperator({ clerkUserId, name }: { clerkUserId: string; name: string }) {
  const [state, remove, removing] = useActionState<RemoveState, FormData>(removeOperator, {
    status: "idle",
  });
  return (
    <div className="sm:text-right">
      <ConfirmDialog
        trigger="Remove"
        title={`Remove ${name} as an operator?`}
        description="They lose access to application review and operator management on their next request. Any team access they have is not affected. You can add them again later."
        confirmLabel="Remove operator"
        pendingLabel="Removing…"
        cancelLabel="Keep operator"
        action={remove}
        pending={removing}
        error={state.status === "error" ? state.message : undefined}
        fields={{ clerkUserId }}
      />
    </div>
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
          <Button type="submit" variant="outline" isDisabled={busy} isPending={resending}>
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
            resent.status === "error" ? "text-sm font-medium text-danger" : "text-sm text-muted"
          }
        >
          {resent.message}
        </p>
      ) : null}
    </div>
  );
}
