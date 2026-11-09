import { createHash, randomBytes } from "node:crypto";
import { sql } from "kysely";
import { db } from "../db.ts";
import { withTenant } from "./tenant.ts";
import { webAdminMember } from "./web-admin.ts";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function organizationIds() {
  return (await sql<{ id: string }>`select scouting_organization_ids() as id`.execute(db)).rows.map(
    (r) => r.id,
  );
}
export async function telegramAdmin(
  org: string,
  subject: string,
  action: "state" | "connect" | "disconnect",
): Promise<
  { token: string; expiresAt: string } | { connected: boolean; connectedAt: string | null } | null
> {
  return withTenant(org, async (tx) => {
    const admin = await webAdminMember(tx, org, subject);
    if (!admin) return null;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${org}:${admin.id}:telegram`}, 0))`.execute(
      tx,
    );
    if (action === "disconnect") {
      await tx
        .deleteFrom("channel_identity")
        .where("organization_id", "=", org)
        .where("member_id", "=", admin.id)
        .where("channel", "=", "telegram")
        .execute();
      await sql`delete from telegram_connect where organization_id=${org}::uuid and member_id=${admin.id}::uuid and used_at is null`.execute(
        tx,
      );
    }
    if (action === "connect") {
      const token = randomBytes(24).toString("base64url");
      await sql`delete from telegram_connect where organization_id=${org}::uuid and member_id=${admin.id}::uuid and used_at is null`.execute(
        tx,
      );
      const created = await sql<{
        expires_at: Date;
      }>`insert into telegram_connect (organization_id, member_id, token_hash, clerk_user_id) values (${org}::uuid, ${admin.id}::uuid, ${hash(token)}, ${subject}) returning expires_at`.execute(
        tx,
      );
      return { token, expiresAt: new Date(created.rows[0]?.expires_at ?? "").toISOString() };
    }
    const identity = await tx
      .selectFrom("channel_identity")
      .select("created_at")
      .where("organization_id", "=", org)
      .where("member_id", "=", admin.id)
      .where("channel", "=", "telegram")
      .executeTakeFirst();
    return {
      connected: !!identity,
      connectedAt: identity ? new Date(identity.created_at).toISOString() : null,
    };
  });
}
export async function consumeConnect(org: string, token: string, user: string) {
  return withTenant(org, async (tx) => {
    const link = (
      await sql<{
        clerk_user_id: string;
        member_id: string;
      }>`select clerk_user_id, member_id from telegram_connect where organization_id=${org}::uuid and token_hash=${hash(token)}`.execute(
        tx,
      )
    ).rows[0];
    if (!link) return false;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${org}:${link.member_id}:telegram`}, 0))`.execute(
      tx,
    );
    await sql`select set_config('app.clerk_user_id', ${link.clerk_user_id}, true)`.execute(tx);
    const row = (
      await sql<{
        member_id: string;
      }>`select c.member_id from telegram_connect c join member m on m.id=c.member_id and m.organization_id=c.organization_id join web_admin_access w on w.member_id=m.id and w.organization_id=m.organization_id where c.organization_id=${org}::uuid and c.token_hash=${hash(token)} and c.used_at is null and c.expires_at > now() and m.role='admin' and w.clerk_user_id is not null for update of c`.execute(
        tx,
      )
    ).rows[0];
    if (!row) return false;
    const identities = await tx
      .selectFrom("channel_identity")
      .select(["external_id", "member_id"])
      .where("organization_id", "=", org)
      .where("channel", "=", "telegram")
      .where((eb) => eb.or([eb("external_id", "=", user), eb("member_id", "=", row.member_id)]))
      .execute();
    if (identities.some((i) => i.member_id !== row.member_id || i.external_id !== user))
      return false;
    if (!identities.length)
      await tx
        .insertInto("channel_identity")
        .values({
          organization_id: org,
          member_id: row.member_id,
          channel: "telegram",
          external_id: user,
        })
        .execute();
    await sql`update telegram_connect set used_at=now(), used_by=${user} where token_hash=${hash(token)} and organization_id=${org}::uuid`.execute(
      tx,
    );
    return true;
  });
}
export async function tokenOrganization(token: string, connect: boolean) {
  for (const org of await organizationIds()) {
    const found = await withTenant(org, async (tx) =>
      connect
        ? (
            await sql`select 1 from telegram_connect where organization_id=${org}::uuid and token_hash=${hash(token)}`.execute(
              tx,
            )
          ).rows.length > 0
        : !!(await tx
            .selectFrom("invitation")
            .select("id")
            .where("organization_id", "=", org)
            .where("token_hash", "=", hash(token))
            .executeTakeFirst()),
    );
    if (found) return org;
  }
  return null;
}
export async function senderTeams(user: string) {
  const teams: { id: string; name: string; teamNumber: number }[] = [];
  for (const org of await organizationIds()) {
    const team = await withTenant(org, (tx) =>
      tx
        .selectFrom("channel_identity")
        .innerJoin("organization", "organization.id", "channel_identity.organization_id")
        .select([
          "organization.id",
          "organization.name",
          "organization.frc_team_number as teamNumber",
        ])
        .where("channel_identity.channel", "=", "telegram")
        .where("channel_identity.external_id", "=", user)
        .where("channel_identity.organization_id", "=", org)
        .executeTakeFirst(),
    );
    if (team) teams.push(team);
  }
  return teams;
}
export function activeTeam(user: string, set?: string) {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.telegram_user_id', ${user}, true)`.execute(tx);
    if (set)
      await sql`insert into telegram_active_team values (${user}, ${set}::uuid) on conflict (external_id) do update set organization_id=excluded.organization_id`.execute(
        tx,
      );
    return (
      await sql<{
        organization_id: string;
      }>`select organization_id from telegram_active_team where external_id=${user}`.execute(tx)
    ).rows[0]?.organization_id;
  });
}

// A webhook retry keeps its original team even after /team changes.
export function bindMessageTeam(user: string, update: string, org: string) {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.telegram_user_id', ${user}, true)`.execute(tx);
    await sql`insert into telegram_message_route (update_id, external_id, organization_id) values (${update}, ${user}, ${org}::uuid) on conflict (external_id, update_id) do nothing`.execute(
      tx,
    );
    return (
      await sql<{
        organization_id: string;
      }>`select organization_id from telegram_message_route where update_id=${update} and external_id=${user}`.execute(
        tx,
      )
    ).rows[0]?.organization_id;
  });
}
