import { sql, type Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import { db } from "../db.ts";

export interface ReviewApplication {
  id: string;
  name: string;
  email: string;
  teamNumber: number;
  role: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  organizationId: string | null;
  invitedAt: string | null;
  claimedAt: string | null;
}

export type ApproveOutcome =
  | { outcome: "approved"; organizationId: string; memberId: string; email: string }
  | { outcome: "forbidden" | "invalid_name" | "not_pending" | "team_exists" };

// The subject comes only from a verified Clerk session. RLS on the operator
// and application tables reads this transaction-local setting. The explicit
// operator check also protects connections that bypass RLS.
function asOperator<T>(subject: string, fallback: T, run: (tx: Transaction<DB>) => Promise<T>) {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.clerk_user_id', ${subject}, true)`.execute(tx);
    const operator = await tx
      .selectFrom("platform_operator")
      .select("clerk_user_id")
      .where("clerk_user_id", "=", subject)
      .executeTakeFirst();
    return operator ? run(tx) : fallback;
  });
}

export function operatorProfile(subject: string) {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.clerk_user_id', ${subject}, true)`.execute(tx);
    return tx
      .selectFrom("platform_operator")
      .select("name")
      .where("clerk_user_id", "=", subject)
      .executeTakeFirst();
  });
}

export function reviewApplications(subject: string, status: "pending" | "reviewed") {
  return asOperator(subject, [] as ReviewApplication[], async (tx) => {
    let query = tx
      .selectFrom("access_application")
      .select([
        "id",
        "name",
        "email",
        "team_number",
        "team_role",
        "status",
        "created_at",
        "reviewed_at",
        "organization_id",
        "invited_at",
        "claimed_at",
      ]);
    query =
      status === "pending"
        ? query.where("status", "=", "pending").orderBy("created_at", "asc")
        : query.where("status", "<>", "pending").orderBy("reviewed_at", "desc").limit(50);
    const rows = await query.orderBy("id").execute();
    const iso = (value: Date | string | null) =>
      value === null ? null : new Date(value).toISOString();
    return rows.map(
      (row): ReviewApplication => ({
        id: row.id,
        name: row.name,
        email: row.email,
        teamNumber: row.team_number,
        role: row.team_role,
        status: row.status as ReviewApplication["status"],
        createdAt: new Date(row.created_at).toISOString(),
        reviewedAt: iso(row.reviewed_at),
        organizationId: row.organization_id,
        invitedAt: iso(row.invited_at),
        claimedAt: iso(row.claimed_at),
      }),
    );
  });
}

export async function approveApplication(
  subject: string,
  id: string,
  organizationName: string,
): Promise<ApproveOutcome> {
  return asOperator<ApproveOutcome>(subject, { outcome: "forbidden" }, async (tx) => {
    const { rows } = await sql<{
      outcome: string;
      provisioned_organization: string | null;
      provisioned_member: string | null;
    }>`select * from approve_access_application(${id}::uuid, ${subject}, ${organizationName})`.execute(
      tx,
    );
    const row = rows[0];
    if (row?.outcome !== "approved" || !row.provisioned_organization || !row.provisioned_member)
      return {
        outcome: (row?.outcome ?? "not_pending") as Exclude<ApproveOutcome["outcome"], "approved">,
      };
    const application = await tx
      .selectFrom("access_application")
      .select("email")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return {
      outcome: "approved",
      organizationId: row.provisioned_organization,
      memberId: row.provisioned_member,
      email: application.email,
    };
  });
}

export async function rejectApplication(subject: string, id: string) {
  const { rows } = await sql<{
    outcome: "forbidden" | "rejected" | "not_pending";
  }>`select reject_access_application(${id}::uuid, ${subject}) as outcome`.execute(db);
  return rows[0]?.outcome ?? "not_pending";
}

// Returns the approved, unclaimed application for an invitation retry.
export function invitableApplication(subject: string, id: string) {
  return asOperator(subject, undefined, (tx) =>
    tx
      .selectFrom("access_application")
      .select(["id", "email"])
      .where("id", "=", id)
      .where("status", "=", "approved")
      .where("claimed_at", "is", null)
      .executeTakeFirst(),
  );
}

export async function recordInvitation(subject: string, id: string, invitationId: string) {
  const { rows } = await sql<{
    recorded: boolean;
  }>`select record_access_invitation(${id}::uuid, ${subject}, ${invitationId}) as recorded`.execute(
    db,
  );
  return rows[0]?.recorded === true;
}

export async function claimApplication(subject: string, id: string, verifiedEmails: string[]) {
  const { rows } = await sql<{
    organization: string | null;
  }>`select claim_access_application(${id}::uuid, ${subject}, ${verifiedEmails}::text[]) as organization`.execute(
    db,
  );
  return rows[0]?.organization ?? null;
}

// Operator-only, using the migration/owner connection.
export async function addOperator(subject: string, name: string) {
  await db
    .insertInto("platform_operator")
    .values({ clerk_user_id: subject, name })
    .onConflict((conflict) => conflict.column("clerk_user_id").doUpdateSet({ name }))
    .execute();
}

export async function removeOperator(subject: string) {
  const result = await db
    .deleteFrom("platform_operator")
    .where("clerk_user_id", "=", subject)
    .executeTakeFirst();
  return result.numDeletedRows > 0n;
}
