import { sql } from "kysely";
import { db } from "../db.ts";

// Operator team directory (#41). Each function calls a SECURITY DEFINER
// database function that rechecks the acting operator. None returns email
// addresses, account IDs or key secrets, except revealApiKeyCiphertext.

export const TEAMS_PAGE_SIZE = 25;

export interface DirectoryTeam {
  id: string;
  name: string;
  teamNumber: number;
  createdAt: string;
  adminCount: number;
  webAdminCount: number;
  pendingInvitationCount: number;
  activeKeyCount: number;
}

export interface DirectoryPage {
  teams: DirectoryTeam[];
  total: number;
}

export interface DirectoryAdmin {
  memberId: string;
  name: string;
  addedAt: string;
  webAccess: "none" | "approved" | "linked";
  approvedAt: string | null;
}

export interface DirectoryInvitation {
  id: string;
  name: string;
  existingAccount: boolean;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  sent: boolean;
}

export interface DirectoryApiKey {
  id: string;
  name: string;
  start: string;
  rateLimitPerMinute: number;
  createdAt: string;
  revokedAt: string | null;
}

export interface DirectoryTeamDetail {
  team: { id: string; name: string; teamNumber: number; createdAt: string };
  administrators: DirectoryAdmin[];
  invitations: DirectoryInvitation[];
  keys: DirectoryApiKey[];
}

export type RevealOutcome =
  | { outcome: "revealed"; ciphertext: string }
  | { outcome: "forbidden" | "not_found" | "revoked" };

const iso = (value: Date | string) => new Date(value).toISOString();

export async function listDirectoryTeams(
  actor: string,
  search: string,
  page: number,
): Promise<DirectoryPage> {
  const offset = (page - 1) * TEAMS_PAGE_SIZE;
  const { rows } = await sql<{
    id: string;
    name: string;
    team_number: number;
    created_at: Date | string;
    admin_count: number;
    web_admin_count: number;
    pending_invitation_count: number;
    active_key_count: number;
    total_count: number;
  }>`select * from list_operator_teams(${actor}, ${search}, ${TEAMS_PAGE_SIZE}, ${offset})`.execute(
    db,
  );
  let total = rows[0]?.total_count ?? 0;
  // A page past the end has no rows, so count the matches from the first page.
  if (!rows.length && offset > 0) {
    const first = await sql<{
      total_count: number;
    }>`select total_count from list_operator_teams(${actor}, ${search}, 1, 0)`.execute(db);
    total = first.rows[0]?.total_count ?? 0;
  }
  return {
    total,
    teams: rows.map((row) => ({
      id: row.id,
      name: row.name,
      teamNumber: row.team_number,
      createdAt: iso(row.created_at),
      adminCount: row.admin_count,
      webAdminCount: row.web_admin_count,
      pendingInvitationCount: row.pending_invitation_count,
      activeKeyCount: row.active_key_count,
    })),
  };
}

// One transaction, so the sections describe the same moment. Undefined when
// the team does not exist or the actor is not an operator.
export function directoryTeam(
  actor: string,
  org: string,
): Promise<DirectoryTeamDetail | undefined> {
  return db.transaction().execute(async (tx) => {
    const team = (
      await sql<{
        id: string;
        name: string;
        team_number: number;
        created_at: Date | string;
      }>`select * from operator_team(${actor}, ${org}::uuid)`.execute(tx)
    ).rows[0];
    if (!team) return undefined;
    const admins = await sql<{
      member_id: string;
      name: string;
      added_at: Date | string;
      web_access: DirectoryAdmin["webAccess"];
      approved_at: Date | string | null;
    }>`select * from list_operator_team_admins(${actor}, ${org}::uuid)`.execute(tx);
    const invitations = await sql<{
      id: string;
      name: string;
      existing_account: boolean;
      invited_by_name: string | null;
      created_at: Date | string;
      expires_at: Date | string;
      sent: boolean;
    }>`select * from list_operator_team_admin_invitations(${actor}, ${org}::uuid)`.execute(tx);
    const keys = await sql<{
      id: string;
      name: string;
      start: string;
      rate_limit_per_minute: number;
      created_at: Date | string;
      revoked_at: Date | string | null;
    }>`select * from list_operator_api_keys(${actor}, ${org}::uuid)`.execute(tx);
    return {
      team: {
        id: team.id,
        name: team.name,
        teamNumber: team.team_number,
        createdAt: iso(team.created_at),
      },
      administrators: admins.rows.map((row) => ({
        memberId: row.member_id,
        name: row.name,
        addedAt: iso(row.added_at),
        webAccess: row.web_access,
        approvedAt: row.approved_at === null ? null : iso(row.approved_at),
      })),
      invitations: invitations.rows.map((row) => ({
        id: row.id,
        name: row.name,
        existingAccount: row.existing_account,
        invitedByName: row.invited_by_name,
        createdAt: iso(row.created_at),
        expiresAt: iso(row.expires_at),
        sent: row.sent,
      })),
      keys: keys.rows.map((row) => ({
        id: row.id,
        name: row.name,
        start: row.start,
        rateLimitPerMinute: row.rate_limit_per_minute,
        createdAt: iso(row.created_at),
        revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
      })),
    };
  });
}

export async function revealApiKeyCiphertext(
  actor: string,
  org: string,
  id: string,
): Promise<RevealOutcome> {
  const { rows } = await sql<{
    outcome: "forbidden" | "not_found" | "revoked" | "revealed";
    secret_ciphertext: string | null;
  }>`select * from reveal_operator_api_key(${actor}, ${org}::uuid, ${id}::uuid)`.execute(db);
  const row = rows[0];
  if (row?.outcome === "revealed" && row.secret_ciphertext)
    return { outcome: "revealed", ciphertext: row.secret_ciphertext };
  return { outcome: row && row.outcome !== "revealed" ? row.outcome : "not_found" };
}

export type OperatorRevokeOutcome = "revoked" | "already_revoked" | "forbidden" | "not_found";

// Locks the key, revokes it with the provider, then records it, in one
// transaction. If the provider fails, the error rolls back and the key stays
// listed as active, so the operator can retry.
export function revokeDirectoryApiKey(
  actor: string,
  org: string,
  id: string,
  revokeWithProvider: (providerKeyId: string) => Promise<void>,
): Promise<OperatorRevokeOutcome> {
  return db.transaction().execute(async (tx) => {
    const { rows } = await sql<{
      outcome: "forbidden" | "not_found" | "already_revoked" | "locked";
      provider_key_id: string | null;
    }>`select * from lock_operator_api_key(${actor}, ${org}::uuid, ${id}::uuid)`.execute(tx);
    const row = rows[0];
    if (!row) return "not_found";
    if (row.outcome !== "locked" || !row.provider_key_id)
      return row.outcome as OperatorRevokeOutcome;
    await revokeWithProvider(row.provider_key_id);
    const done = await sql<{
      done: boolean;
    }>`select complete_operator_api_key_revoke(${actor}, ${org}::uuid, ${id}::uuid) as done`.execute(
      tx,
    );
    return done.rows[0]?.done ? "revoked" : "not_found";
  });
}

export type RemoveAdminOutcome =
  | { outcome: "removed"; clerkInvitationIds: string[] }
  | { outcome: "forbidden" | "not_found" };

export async function removeDirectoryAdmin(
  actor: string,
  org: string,
  memberId: string,
): Promise<RemoveAdminOutcome> {
  const { rows } = await sql<{
    outcome: "forbidden" | "not_found" | "removed";
    clerk_invitation_ids: string[] | null;
  }>`select * from remove_operator_team_admin(${actor}, ${org}::uuid, ${memberId}::uuid)`.execute(
    db,
  );
  const row = rows[0];
  if (row?.outcome === "removed")
    return { outcome: "removed", clerkInvitationIds: row.clerk_invitation_ids ?? [] };
  return { outcome: row?.outcome === "forbidden" ? "forbidden" : "not_found" };
}
