import { sql } from "kysely";
import { db } from "../db.ts";
import { withTenant } from "./tenant.ts";

export interface AdminOrganization {
  id: string;
  name: string;
  teamNumber: number;
}

// Subject comes only from a verified Clerk session, never a client-supplied ID.
// Discover only its approved links, then apply existing tenant RLS and live roles.
export async function adminOrganizations(subject: string): Promise<AdminOrganization[]> {
  const links = await db.transaction().execute(async (tx) => {
    await sql`select set_config('app.clerk_user_id', ${subject}, true)`.execute(tx);
    return tx
      .selectFrom("web_admin_access")
      .select(["organization_id", "member_id"])
      .where("clerk_user_id", "=", subject)
      .execute();
  });
  const organizations = await Promise.all(
    links.map((link) =>
      withTenant(link.organization_id, async (tx) => {
        const row = await tx
          .selectFrom("member")
          .innerJoin("organization", "organization.id", "member.organization_id")
          .select([
            "organization.id",
            "organization.name",
            "organization.frc_team_number as teamNumber",
          ])
          .where("member.organization_id", "=", link.organization_id)
          .where("member.id", "=", link.member_id)
          .where("member.role", "=", "admin")
          .executeTakeFirst();
        return row;
      }),
    ),
  );
  return organizations
    .filter((row): row is AdminOrganization => row !== undefined)
    .sort((a, b) => a.teamNumber - b.teamNumber || a.id.localeCompare(b.id));
}

// Operator-only, using the migration/owner connection. Runtime has SELECT only.
export function approveWebAdmin(input: {
  organizationId: string;
  memberId: string;
  approverId: string;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const members = await tx
      .selectFrom("member")
      .select(["id", "role"])
      .where("organization_id", "=", input.organizationId)
      .where("id", "in", [input.memberId, input.approverId])
      .forUpdate()
      .execute();
    if (
      ![input.memberId, input.approverId].every((id) =>
        members.some((m) => m.id === id && m.role === "admin"),
      )
    )
      throw Error("Both the member and approving lead must be existing team admins");
    // Never silently relink an existing account. Revocation must be explicit.
    await tx
      .insertInto("web_admin_access")
      .values({
        organization_id: input.organizationId,
        member_id: input.memberId,
        approved_by: input.approverId,
      })
      .execute();
  });
}

export function revokeWebAdmin(organizationId: string, memberId: string) {
  return withTenant(organizationId, (tx) =>
    tx
      .deleteFrom("web_admin_access")
      .where("organization_id", "=", organizationId)
      .where("member_id", "=", memberId)
      .execute(),
  );
}

export function linkWebAdmin(organizationId: string, memberId: string, subject: string) {
  return withTenant(organizationId, async (tx) => {
    const member = await tx
      .selectFrom("member")
      .select("role")
      .where("organization_id", "=", organizationId)
      .where("id", "=", memberId)
      .forUpdate()
      .executeTakeFirst();
    if (member?.role !== "admin") throw Error("Existing administrator required");
    const result = await tx
      .updateTable("web_admin_access")
      .set({ clerk_user_id: subject })
      .where("organization_id", "=", organizationId)
      .where("member_id", "=", memberId)
      .where("clerk_user_id", "is", null)
      .executeTakeFirst();
    if (result.numUpdatedRows !== 1n) throw Error("Unlinked adult approval required");
  });
}
