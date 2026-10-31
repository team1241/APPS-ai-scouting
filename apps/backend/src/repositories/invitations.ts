import { createHash, randomBytes } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import { withTenant } from "./tenant.ts";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
async function member(tx: Transaction<DB>, organizationId: string, userId: string) {
  return tx
    .selectFrom("channel_identity")
    .innerJoin("member", (join) =>
      join
        .onRef("member.id", "=", "channel_identity.member_id")
        .onRef("member.organization_id", "=", "channel_identity.organization_id"),
    )
    .select(["member.id", "member.role"])
    .where("channel_identity.organization_id", "=", organizationId)
    .where("channel", "=", "telegram")
    .where("external_id", "=", userId)
    .executeTakeFirst();
}
export function memberRole(organizationId: string, userId: string) {
  return withTenant(organizationId, (tx) => member(tx, organizationId, userId));
}
export function createInvitation(
  organizationId: string,
  userId: string,
  updateId: string,
  label: string,
) {
  return withTenant(organizationId, async (tx) => {
    const admin = await member(tx, organizationId, userId);
    if (admin?.role !== "admin") return { status: "forbidden" } as const;
    const token = randomBytes(24).toString("base64url");
    const row = await tx
      .insertInto("invitation")
      .values({
        organization_id: organizationId,
        created_by: admin.id,
        label: label.slice(0, 80) || "Team scouts",
        token_hash: hash(token),
        source_update_id: updateId,
      })
      .onConflict((oc) => oc.columns(["organization_id", "source_update_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    return row
      ? ({ status: "created", id: row.id, token } as const)
      : ({ status: "duplicate" } as const);
  });
}
export function listInvitations(organizationId: string, userId: string) {
  return withTenant(organizationId, async (tx) => {
    if ((await member(tx, organizationId, userId))?.role !== "admin") return null;
    return tx
      .selectFrom("invitation")
      .select(["id", "label", "uses", "revoked_at"])
      .where("organization_id", "=", organizationId)
      .orderBy("created_at", "desc")
      .limit(20)
      .execute();
  });
}
export function revokeInvitation(organizationId: string, userId: string, id: string) {
  return withTenant(organizationId, async (tx) => {
    if ((await member(tx, organizationId, userId))?.role !== "admin") return "forbidden";
    const row = await tx
      .updateTable("invitation")
      .set({ revoked_at: new Date() })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    return row ? "revoked" : "missing";
  });
}
export function joinInvitation(
  organizationId: string,
  userId: string,
  name: string,
  token: string,
) {
  return withTenant(organizationId, async (tx) => {
    // Lock the joining identity across links without granting organization UPDATE.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${userId}`}, 0))`.execute(
      tx,
    );
    const invite = await tx
      .selectFrom("invitation")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("token_hash", "=", hash(token))
      .forUpdate()
      .executeTakeFirst();
    if (!invite || invite.revoked_at) return "invalid";
    if (await member(tx, organizationId, userId)) return "already_joined";
    const scout = await tx
      .insertInto("member")
      .values({
        organization_id: organizationId,
        name: name.trim().slice(0, 100) || "Scout",
        role: "scout",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("channel_identity")
      .values({
        organization_id: organizationId,
        member_id: scout.id,
        channel: "telegram",
        external_id: userId,
      })
      .execute();
    await tx
      .updateTable("invitation")
      .set({ uses: sql`uses + 1` })
      .where("organization_id", "=", organizationId)
      .where("id", "=", invite.id)
      .execute();
    return "joined";
  });
}
