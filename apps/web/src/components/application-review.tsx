"use client";

import { Button, FieldError, Input, Label, TextField } from "@heroui/react";
import { useActionState } from "react";
import {
  approveApplication,
  type ReviewState,
  rejectApplication,
  resendInvitation,
} from "@/app/operator/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useEditedErrors } from "@/lib/use-edited-errors";

const idle: ReviewState = { status: "idle" };

function Feedback({ state }: { state: ReviewState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error" ? "text-sm font-medium text-danger" : "text-sm text-muted"
      }
    >
      {state.message}
    </p>
  );
}

// Approve needs a team name; reject is confirmed in a dialog.
export function PendingReview({
  applicationId,
  teamNumber,
}: {
  applicationId: string;
  teamNumber: number;
}) {
  const [approval, approve, approving] = useActionState(approveApplication, idle);
  const [rejection, reject, rejecting] = useActionState(rejectApplication, idle);
  const busy = approving || rejecting;
  const { edit, shown } = useEditedErrors<"organizationName">(approval);
  const nameError = shown("organizationName", approval.fieldError);
  return (
    <div className="space-y-3">
      <form action={approve} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <input type="hidden" name="applicationId" value={applicationId} />
        <TextField
          name="organizationName"
          defaultValue={`Team ${teamNumber}`}
          maxLength={120}
          isRequired
          isDisabled={busy}
          isInvalid={nameError ? true : undefined}
          onChange={() => edit("organizationName")}
          validationBehavior="aria"
          fullWidth
          className="min-w-0 flex-1"
        >
          <Label>Team name</Label>
          <Input />
          <FieldError>{nameError}</FieldError>
        </TextField>
        <Button type="submit" isDisabled={busy} isPending={approving} className="px-5 sm:mt-7">
          {approving ? "Approving…" : "Approve and invite"}
        </Button>
      </form>
      <Feedback state={approval} />
      <div className="-ml-3">
        <ConfirmDialog
          trigger="Reject"
          title={`Reject the application for Team ${teamNumber}?`}
          description="The team cannot apply again, and the applicant is not notified. This cannot be undone here."
          confirmLabel="Reject application"
          pendingLabel="Rejecting…"
          cancelLabel="Keep reviewing"
          action={reject}
          pending={rejecting}
          error={rejection.status === "error" ? rejection.message : undefined}
          disabled={busy}
          fields={{ applicationId }}
        />
      </div>
    </div>
  );
}

export function ResendInvitation({ applicationId }: { applicationId: string }) {
  const [state, resend, sending] = useActionState(resendInvitation, idle);
  return (
    <form action={resend} className="space-y-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Button type="submit" variant="outline" isPending={sending}>
        {sending ? "Sending…" : "Resend invitation"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
