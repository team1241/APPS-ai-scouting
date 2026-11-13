import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { db } from "./db.ts";
import { enrollMember } from "./repositories/members.ts";
import {
  activeTeam,
  bindMessageTeam,
  consumeConnect,
  senderTeams,
  telegramAdmin,
  tokenOrganization,
} from "./repositories/telegram-connect.ts";
import { approveWebAdmin, linkWebAdmin } from "./repositories/web-admin.ts";
import { telegramRoutes } from "./telegram.ts";

after(() => db.destroy());
test("single-use admin connections preserve members, enforce tenant isolation and require explicit multi-team routing", async () => {
  const orgs = [randomUUID(), randomUUID()];
  const subject = `user_${randomUUID().replaceAll("-", "")}`;
  const user = String(Math.floor(Math.random() * 1e12));
  const members: string[] = [];
  const app = telegramRoutes("secret");
  const post = async (text: string) =>
    (
      await app.request("/", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            from: { id: Number(user) },
            chat: { id: Number(user), type: "private" },
            text,
          },
        }),
      })
    ).json() as Promise<{
      text: string;
      reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
    }>;
  const tap = async (data: string) =>
    (
      await app.request("/", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          update_id: 2,
          callback_query: {
            id: "callback-fixture",
            from: { id: Number(user) },
            message: { chat: { id: Number(user), type: "private" } },
            data,
          },
        }),
      })
    ).json() as Promise<{ method: string; text: string }>;
  try {
    for (const org of orgs) {
      const member = await enrollMember({
        organizationId: org,
        organizationName: "Connect fixture",
        frcTeamNumber: org === orgs[0] ? 1241 : 5678,
        memberName: "Admin",
        role: "admin",
        channel: "fixture",
        externalUserId: randomUUID(),
      });
      members.push(member);
      await approveWebAdmin({ organizationId: org, memberId: member, approverId: member });
      await linkWebAdmin(org, member, subject);
      assert.equal(await telegramAdmin(org, "user_stranger", "connect"), null);
      const link = await telegramAdmin(org, subject, "connect");
      assert.ok(link && "token" in link);
      assert.ok(Date.parse(link.expiresAt) > Date.now());
      assert.equal(await tokenOrganization(link.token, true), org);
      assert.equal(
        await consumeConnect(orgs.find((id) => id !== org) ?? "", link.token, user),
        false,
      );
      const confirmation = await post(`/start connect_${link.token}`);
      assert.match(
        confirmation.text,
        new RegExp(`admin account for Team ${org === orgs[0] ? 1241 : 5678}\\.`),
      );
      assert.equal(await consumeConnect(org, link.token, user), false);
      const state = await telegramAdmin(org, subject, "state");
      assert.ok(state && "connected" in state && state.connected && state.connectedAt);
    }
    assert.equal((await senderTeams(user)).length, 2);
    assert.equal(await bindMessageTeam(user, "retry-fixture", orgs[0] ?? ""), orgs[0]);
    assert.equal(await bindMessageTeam(user, "retry-fixture", orgs[1] ?? ""), orgs[0]);
    assert.match((await post("Team 1241 climbed")).text, /Choose a team/);
    const picker = await post("/team");
    const buttons = picker.reply_markup?.inline_keyboard.flat();
    assert.equal(buttons?.length, 2);
    assert.deepEqual(
      buttons?.map((b) => b.callback_data).sort(),
      orgs.map((org) => `team:${org}`).sort(),
    );
    assert.ok(buttons?.some((b) => b.text === "1241 · Connect fixture"));
    assert.ok(buttons?.some((b) => b.text === "5678 · Connect fixture"));
    const selected = await tap(`team:${orgs[0]}`);
    assert.equal(selected.method, "answerCallbackQuery");
    assert.match(selected.text, /Active team: 1241/);
    assert.equal(await activeTeam(user), orgs[0]);
    assert.match((await tap(`team:${randomUUID()}`)).text, /no longer have access/);
    assert.equal(await activeTeam(user), orgs[0]);
    assert.match((await post("Team 1241 climbed")).text, /no event is active/);
    assert.match((await post(`/team ${randomUUID()}`)).text, /Choose a team/);
    const count = await db
      .selectFrom("member")
      .select(sql<number>`count(*)::int`.as("count"))
      .where("organization_id", "in", orgs)
      .executeTakeFirstOrThrow();
    assert.equal(count.count, 2);
    const role = `connect_${randomUUID().replaceAll("-", "")}`;
    await sql`create role ${sql.id(role)} nologin`.execute(db);
    try {
      await sql`grant select on telegram_connect to ${sql.id(role)}`.execute(db);
      await sql`grant select on member, web_admin_access, channel_identity to ${sql.id(role)}`.execute(
        db,
      );
      await sql`grant insert on channel_identity to ${sql.id(role)}`.execute(db);
      await sql`grant insert, update, delete on telegram_connect to ${sql.id(role)}`.execute(db);
      const repositoryUrl = new URL("./repositories/telegram-connect.ts", import.meta.url).href;
      const dbUrl = new URL("./db.ts", import.meta.url).href;
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import assert from 'node:assert/strict';
        import { telegramAdmin, consumeConnect } from ${JSON.stringify(repositoryUrl)};
        import { db } from ${JSON.stringify(dbUrl)};
        try {
          const [org, subject, user] = process.argv.slice(1);
          const link = await telegramAdmin(org, subject, 'connect');
          assert.ok(link && 'token' in link);
          assert.equal(await consumeConnect(org, link.token, user), true);
        } finally { await db.destroy(); }
      `,
          orgs[0] ?? "",
          subject,
          user,
        ],
        { env: { ...process.env, PGOPTIONS: `-c role=${role}` } },
      );

      await db.transaction().execute(async (tx) => {
        await sql`set local role ${sql.id(role)}`.execute(tx);
        assert.equal((await sql`select * from telegram_connect`.execute(tx)).rows.length, 0);
        await sql`select set_config('app.organization_id', ${orgs[0]}, true)`.execute(tx);
        const rows = (
          await sql<{
            organization_id: string;
          }>`select organization_id from telegram_connect`.execute(tx)
        ).rows;
        assert.equal(rows.length, 2);
        assert.ok(rows.every((r) => r.organization_id === orgs[0]));
      });
    } finally {
      await sql`drop owned by ${sql.id(role)}`.execute(db);
      await sql`drop role ${sql.id(role)}`.execute(db);
    }
    const org = orgs[0] ?? "";
    await telegramAdmin(org, subject, "disconnect");
    assert.deepEqual(await telegramAdmin(org, subject, "state"), {
      connected: false,
      connectedAt: null,
    });
    assert.match((await tap(`team:${org}`)).text, /no longer have access/);
    const expired = await telegramAdmin(org, subject, "connect");
    assert.ok(expired && "token" in expired);
    await sql`update telegram_connect set expires_at=now()-interval '1 minute' where organization_id=${org}::uuid`.execute(
      db,
    );
    assert.equal(await consumeConnect(org, expired.token, user), false);
    const revoked = await telegramAdmin(org, subject, "connect");
    assert.ok(revoked && "token" in revoked);
    await db.deleteFrom("web_admin_access").where("organization_id", "=", org).execute();
    assert.equal(await consumeConnect(org, revoked.token, user), false);
  } finally {
    await sql`delete from telegram_active_team where external_id=${user}`.execute(db);
    for (const org of orgs) {
      await sql`delete from telegram_connect where organization_id=${org}::uuid`.execute(db);
      await db.deleteFrom("web_admin_access").where("organization_id", "=", org).execute();
      await db.deleteFrom("intake_rejection").where("organization_id", "=", org).execute();
      await db.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
      await db.deleteFrom("member").where("organization_id", "=", org).execute();
      await db.deleteFrom("organization").where("id", "=", org).execute();
    }
  }
});
