"use client";

import { Button } from "@heroui/react";
import { useActionState } from "react";
import {
  type AdminInvitationState,
  acceptAdministratorInvitation,
} from "@/app/admin/administrator-actions";
import { TeamNumber } from "@/components/page-heading";

export interface AccountInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  teamNumber: number;
  invitedByName: string;
  expiresAt: string;
}

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

function InvitationRow({ invitation }: { invitation: AccountInvitation }) {
  const [state, accept, accepting] = useActionState<AdminInvitationState, FormData>(
    acceptAdministratorInvitation,
    { status: "idle" },
  );
  return (
    <li className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
      <TeamNumber value={invitation.teamNumber} className="w-24 shrink-0 text-3xl" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold [overflow-wrap:anywhere]">{invitation.organizationName}</p>
        <p className="text-sm text-muted">
          {invitation.invitedByName} invited you to administer this team. Expires{" "}
          <time dateTime={invitation.expiresAt}>
            {dateFormat.format(new Date(invitation.expiresAt))}
          </time>
          .
        </p>
        {state.status === "error" && state.message ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {state.message}
          </p>
        ) : null}
      </div>
      <form action={accept} className="shrink-0">
        <input type="hidden" name="invitationId" value={invitation.id} />
        <Button type="submit" isPending={accepting} className="w-full sm:w-auto">
          {accepting ? "Accepting…" : "Accept and open team"}
        </Button>
      </form>
    </li>
  );
}

// Invitations from team admins to this signed-in account. Nothing is granted
// until the account accepts.
export function AdministratorInvitations({ invitations }: { invitations: AccountInvitation[] }) {
  if (!invitations.length) return null;
  return (
    <section aria-labelledby="invitations-title" className="space-y-3">
      <h2 id="invitations-title" className="text-lg font-semibold">
        Invitations
      </h2>
      <ul className="divide-y divide-separator overflow-hidden rounded-2xl bg-surface shadow-surface">
        {invitations.map((invitation) => (
          <InvitationRow key={invitation.id} invitation={invitation} />
        ))}
      </ul>
    </section>
  );
}
