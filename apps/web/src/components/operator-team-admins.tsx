"use client";

import { useActionState } from "react";
import { removeTeamAdministrator, type TeamChangeState } from "@/app/operator/teams/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

// Operators can remove any team admin. The member stays on the team as a scout.
export function RemoveTeamAdministrator({
  organizationId,
  teamNumber,
  memberId,
  name,
  last,
}: {
  organizationId: string;
  teamNumber: number;
  memberId: string;
  name: string;
  last: boolean;
}) {
  const [state, remove, removing] = useActionState<TeamChangeState, FormData>(
    removeTeamAdministrator,
    {},
  );
  return (
    <ConfirmDialog
      trigger="Remove"
      title={`Remove ${name} as an administrator of Team ${teamNumber}?`}
      description={
        <>
          They lose web access and admin rights on their next request, and their pending invitations
          are cancelled. They stay on the team as a scout, with their scouting history.
          {last ? " This team will have no administrators." : null} To make them an admin again,
          another admin must invite them.
        </>
      }
      confirmLabel="Remove administrator"
      pendingLabel="Removing…"
      cancelLabel="Keep administrator"
      action={remove}
      pending={removing}
      error={state.error}
      fields={{ organizationId, memberId }}
    />
  );
}
