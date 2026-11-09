"use client";

import { useActionState, useId } from "react";
import {
  approveApplication,
  type ReviewState,
  rejectApplication,
  resendInvitation,
} from "@/app/operator/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const idle: ReviewState = { status: "idle" };

function Feedback({ state }: { state: ReviewState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
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
  const nameId = useId();
  const busy = approving || rejecting;
  return (
    <div className="space-y-3">
      <form action={approve} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="applicationId" value={applicationId} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor={nameId}>Team name</Label>
          <Input
            id={nameId}
            name="organizationName"
            defaultValue={`Team ${teamNumber}`}
            maxLength={120}
            required
            disabled={busy}
            aria-invalid={approval.fieldError ? true : undefined}
            aria-describedby={approval.fieldError ? `${nameId}-error` : undefined}
            className="h-11"
          />
        </div>
        <Button type="submit" disabled={busy} className="h-11 px-5">
          {approving ? "Approving…" : "Approve and invite"}
        </Button>
      </form>
      {approval.fieldError ? (
        <p id={`${nameId}-error`} className="text-sm text-destructive">
          {approval.fieldError}
        </p>
      ) : null}
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
      <Button type="submit" variant="outline" disabled={sending} className="h-11">
        {sending ? "Sending…" : "Resend invitation"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
