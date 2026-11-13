import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "kysely";
import { db } from "./db.ts";
import { stated } from "./extraction-fixture.ts";
import { cleanupPublished } from "./published-test-cleanup.ts";
import { claimExtraction, finishExtraction } from "./repositories/extraction.ts";
import { saveIncomingNote } from "./repositories/intake.ts";
import { enrollMember } from "./repositories/members.ts";
import { telegramRoutes } from "./telegram.ts";

test("authenticated Telegram intake persists and deduplicates notes", async () => {
  const id = randomUUID();
  const app = telegramRoutes("test-secret");
  const update = {
    update_id: 42,
    message: { from: { id: 123 }, chat: { id: 123, type: "private" }, text: "Q42 1241 climbed" },
  };
  const post = (secret: string) =>
    app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify(update),
    });
  const tenant = <T>(
    fn: (tx: import("kysely").Transaction<import("./db.generated.ts").DB>) => Promise<T>,
  ) =>
    db.transaction().execute(async (tx) => {
      await sql`select set_config('app.organization_id', ${id}, true)`.execute(tx);
      return fn(tx);
    });
  try {
    await tenant(async (tx) => {
      await tx
        .insertInto("organization")
        .values({ id, name: "Intake test", frc_team_number: 1241 })
        .execute();
    });
    assert.equal((await post("wrong")).status, 401);
    assert.match((await (await post("test-secret")).json()).text, /invitation or connection link/);
    const enrollment = {
      organizationId: id,
      organizationName: "Intake test",
      frcTeamNumber: 1241,
      memberName: "Test scout",
      role: "scout" as const,
      channel: "telegram",
      externalUserId: "123",
    };
    const members = await Promise.all([enrollMember(enrollment), enrollMember(enrollment)]);
    assert.equal(members[0], members[1]);
    await tenant(async (tx) => {
      const event = await tx
        .insertInto("event")
        .values({
          organization_id: id,
          name: "Intake practice",
          validation_mode: "off",
          season: 2026,
          type: "practice",
          start_date: "2026-11-07",
          end_date: "2026-11-07",
          timezone: "America/Toronto",
          specification_version: "starter-match-v1",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("organization_event_setting")
        .values({ organization_id: id, active_event_id: event.id })
        .execute();
    });
    // Pit and general are explicit commands. Without an assignment the note is refused.
    const command = async (text: string, update_id: number) =>
      (
        await (
          await app.request("/", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": "test-secret",
            },
            body: JSON.stringify({ update_id, message: { ...update.message, text } }),
          })
        ).json()
      ).text as string;
    assert.match(await command("/pit", 9001), /Add your note after \/pit/);
    assert.match(await command("/pit 1241 swerve", 9002), /pit scouting isn't set up/);
    assert.match(
      await command("/scout not-an-id pit note", 9003),
      /\/scout <event-id> \[pit\|general\] <note>/,
    );
    const responses = await Promise.all([post("test-secret"), post("test-secret")]);
    assert.ok(responses.every((r) => r.status === 200));
    const rows = await tenant((tx) =>
      tx.selectFrom("raw_entry").selectAll().where("organization_id", "=", id).execute(),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.text, update.message.text);
    assert.equal(rows[0]?.status, "pending");
    const claimed = await claimExtraction(id);
    assert.ok(claimed);
    const missing = stated({
      match: "Q42",
      team_number: 1241,
      climbed: null,
      notes: null,
    });
    await finishExtraction(id, claimed.id, claimed.lease, missing, "999");
    await saveIncomingNote({
      organizationId: id,
      channel: "telegram",
      externalUserId: "123",
      externalUpdateId: "43",
      text: "No climb",
      replyToMessageId: "999",
    });
    const resumed = await claimExtraction(id);
    assert.ok(resumed);
    assert.equal(resumed.id, claimed.id);
    assert.notEqual(resumed.turnId, claimed.turnId);
    const session = await tenant((tx) =>
      tx
        .selectFrom("scouting_session")
        .selectAll()
        .where("id", "=", claimed.id)
        .executeTakeFirstOrThrow(),
    );
    assert.equal(session.member_id, members[0]);
    assert.equal(session.match_label, "Q42");
    assert.equal(session.team_number, 1241);
    assert.equal(session.status, "collecting");
    assert.match(JSON.stringify(resumed.messages), /No climb/);
    const completed = stated({
      match: "Q42",
      team_number: 1241,
      climbed: false,
      notes: null,
    });
    await finishExtraction(id, resumed.id, resumed.lease, completed, null);
    const root = await tenant((tx) =>
      tx.selectFrom("raw_entry").selectAll().where("id", "=", claimed.id).executeTakeFirstOrThrow(),
    );
    assert.equal(root.status, "done");
    const completedSession = await tenant((tx) =>
      tx
        .selectFrom("scouting_session")
        .selectAll()
        .where("id", "=", claimed.id)
        .executeTakeFirstOrThrow(),
    );
    assert.equal(completedSession.status, "complete");
    assert.ok(completedSession.completed_at);
    assert.equal(root.text, update.message.text);
    assert.equal(
      await saveIncomingNote({
        organizationId: id,
        channel: "telegram",
        externalUserId: "123",
        externalUpdateId: "44",
        text: "correction",
        replyToMessageId: "999",
      }),
      "completed_session",
    );
  } finally {
    await tenant(async (tx) => {
      await cleanupPublished(tx, id);
      for (const table of [
        "raw_entry",
        "intake_rejection",
        "organization_event_setting",
        "event",
        "channel_identity",
        "member",
      ] as const)
        await tx.deleteFrom(table).where("organization_id", "=", id).execute();
      await tx.deleteFrom("organization").where("id", "=", id).execute();
    });
    await db.destroy();
  }
});
