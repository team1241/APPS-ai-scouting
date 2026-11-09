"use client";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialForm: OperatorFormState = {
  status: "idle",
  errors: {},
  values: { name: "", email: "" },
};

// Radix unmounts this form when the dialog closes, so each open starts empty.
function AddOperatorForm({
  onDone,
  onPendingChange,
}: {
  onDone: (message: string) => void;
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
  const field = (name: "name" | "email", label: string, type: string) => {
    const error = state.errors[name];
    return (
      <div className="space-y-1.5">
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
          aria-describedby={error ? `operator-${name}-error` : undefined}
          className="h-11"
        />
        {error ? (
          <p id={`operator-${name}-error`} className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <form ref={form} action={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Add operator</DialogTitle>
        <DialogDescription>
          People with an account become operators right away. Anyone else gets an email invitation
          that expires in 7 days.
        </DialogDescription>
      </DialogHeader>
      {field("name", "Name", "text")}
      {field("email", "Email", "email")}
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending} className="h-11">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {pending ? "Adding…" : "Add or invite"}
        </Button>
      </DialogFooter>
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
        <h2 id="current-heading" className="text-lg font-semibold">
          Current operators <span className="tabular-nums">({count})</span>
        </h2>
        <Dialog open={open} onOpenChange={(next) => (pending ? null : setOpen(next))}>
          <DialogTrigger asChild>
            <Button type="button" className="h-11 px-5">
              <UserPlus aria-hidden="true" />
              Add operator
            </Button>
          </DialogTrigger>
          <DialogContent>
            <AddOperatorForm onDone={done} onPendingChange={setPending} />
          </DialogContent>
        </Dialog>
      </div>
      <p role="status" className="text-sm text-success empty:hidden">
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
