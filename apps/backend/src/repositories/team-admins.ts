import { sql } from "kysely";
import { db } from "../db.ts";

// Team admin invitations (#40). Each function calls a SECURITY DEFINER
// database function that rechecks the acting admin in the named team.

export interface TeamAdmin {
  memberId: string;
  name: string;
  linked: boolean;
  isSelf: boolean;
  approvedAt: string;
}

export interface TeamAdminInvitation {
  id: string;
  name: string;
  email: string;
  existingAccount: boolean;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  sent: boolean;
}

export interface AccountInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  teamNumber: number;
  invitedByName: string;
  expiresAt: string;
}

export type CreateOutcome =
  | { outcome: "created"; id: string }
  | { outcome: "forbidden" | "invalid" | "exists" | "already_admin" };

export type ResendOutcome =
  | {
      outcome: "resent";
      id: string;
      email: string;
      existingAccount: boolean;
      previousClerkInvitationId: string | null;
    }
  | { outcome: "forbidden" | "not_found" };

export type AcceptOutcome =
  | { outcome: "accepted" | "already_admin"; organizationId: string }
  | { outcome: "unavailable" };

const iso = (value: Date | string) => new Date(value).toISOString();

export async function listTeamAdmins(actor: string, org: string): Promise<TeamAdmin[]> {
  const { rows } = await sql<{
    member_id: string;
    name: string;
    linked: boolean;
    is_self: boolean;
    approved_at: Date | string;
  }>`select * from list_team_admins(${actor}, ${org}::uuid)`.execute(db);
  return rows.map((row) => ({
    memberId: row.member_id,
    name: row.name,
    linked: row.linked,
    isSelf: row.is_self,
    approvedAt: iso(row.approved_at),
  }));
}

export async function listTeamAdminInvitations(
  actor: string,
  org: string,
): Promise<TeamAdminInvitation[]> {
  const { rows } = await sql<{
    id: string;
    name: string;
    email: string;
    existing_account: boolean;
    invited_by_name: string | null;
    created_at: Date | string;
    expires_at: Date | string;
    sent: boolean;
  }>`select * from list_team_admin_invitations(${actor}, ${org}::uuid)`.execute(db);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    existingAccount: row.existing_account,
    invitedByName: row.invited_by_name,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    sent: row.sent,
  }));
}

export async function createTeamAdminInvitation(input: {
  actor: string;
  org: string;
  email: string;
  name: string;
  // The Clerk account that has this verified email, if any.
  target: string | null;
  adultAttested: boolean;
}): Promise<CreateOutcome> {
  const { rows } = await sql<{
    outcome: CreateOutcome["outcome"];
    invitation_id: string | null;
  }>`select * from create_team_admin_invitation(${input.actor}, ${input.org}::uuid, ${input.email}, ${input.name}, ${input.target}, ${input.adultAttested})`.execute(
    db,
  );
  const row = rows[0];
  if (row?.outcome === "created" && row.invitation_id)
    return { outcome: "created", id: row.invitation_id };
  return { outcome: row && row.outcome !== "created" ? row.outcome : "invalid" };
}

export async function recordTeamAdminInvitation(
  actor: string,
  org: string,
  id: string,
  clerkId: string,
) {
  const { rows } = await sql<{
    recorded: boolean;
  }>`select record_team_admin_invitation(${actor}, ${org}::uuid, ${id}::uuid, ${clerkId}) as recorded`.execute(
    db,
  );
  return rows[0]?.recorded === true;
}

export async function resendTeamAdminInvitation(
  actor: string,
  org: string,
  id: string,
): Promise<ResendOutcome> {
  const { rows } = await sql<{
    outcome: "resent" | "forbidden" | "not_found";
    invitation_id: string | null;
    email: string | null;
    existing_account: boolean | null;
    previous_clerk_invitation_id: string | null;
  }>`select * from resend_team_admin_invitation(${actor}, ${org}::uuid, ${id}::uuid)`.execute(db);
  const row = rows[0];
  if (row?.outcome === "resent" && row.invitation_id && row.email)
    return {
      outcome: "resent",
      id: row.invitation_id,
      email: row.email,
      existingAccount: row.existing_account === true,
      previousClerkInvitationId: row.previous_clerk_invitation_id,
    };
  return { outcome: row?.outcome === "forbidden" ? "forbidden" : "not_found" };
}

export async function cancelTeamAdminInvitation(actor: string, org: string, id: string) {
  const { rows } = await sql<{
    outcome: "forbidden" | "not_found" | "cancelled";
    clerk_invitation_id: string | null;
  }>`select * from cancel_team_admin_invitation(${actor}, ${org}::uuid, ${id}::uuid)`.execute(db);
  const row = rows[0];
  return {
    outcome: row?.outcome ?? "not_found",
    clerkInvitationId: row?.clerk_invitation_id ?? null,
  };
}

export async function accountTeamAdminInvitations(subject: string): Promise<AccountInvitation[]> {
  const { rows } = await sql<{
    id: string;
    organization_id: string;
    organization_name: string;
    team_number: number;
    invited_by_name: string;
    expires_at: Date | string;
  }>`select * from list_account_team_admin_invitations(${subject})`.execute(db);
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    teamNumber: row.team_number,
    invitedByName: row.invited_by_name,
    expiresAt: iso(row.expires_at),
  }));
}

// emails must be the account's Clerk-verified emails. fromMetadata is true only
// when the ID came from server-set Clerk public metadata.
export async function acceptTeamAdminInvitation(
  subject: string,
  id: string,
  emails: string[],
  fromMetadata: boolean,
): Promise<AcceptOutcome> {
  const { rows } = await sql<{
    outcome: "accepted" | "already_admin" | "unavailable";
    organization_id: string | null;
  }>`select * from accept_team_admin_invitation(${id}::uuid, ${subject}, ${emails}::text[], ${fromMetadata})`.execute(
    db,
  );
  const row = rows[0];
  if (row && row.outcome !== "unavailable" && row.organization_id)
    return { outcome: row.outcome, organizationId: row.organization_id };
  return { outcome: "unavailable" };
}
