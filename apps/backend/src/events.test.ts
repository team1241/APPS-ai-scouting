import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { db } from "./db.ts";
import { eventCommand } from "./event-commands.ts";
import { parseEventConfig } from "./event-config.ts";
import { stated } from "./extraction-fixture.ts";
import { cleanupPublished } from "./published-test-cleanup.ts";
import { changeEvent, readEvents } from "./repositories/events.ts";
import { claimExtraction, finishExtraction } from "./repositories/extraction.ts";
import { saveIncomingNote } from "./repositories/intake.ts";
import { enrollMember } from "./repositories/members.ts";
import { withTenant } from "./repositories/tenant.ts";
import { telegramRoutes } from "./telegram.ts";

const config = (name: string) =>
  parseEventConfig({
    name,
    season: 2026,
    type: "offseason",
    startDate: "2026-10-31",
    endDate: "2026-11-01",
    timezone: "America/Toronto",
    attending: true,
    source: "frc_events",
    frcEventCode: name.replace(/[^a-z0-9]/gi, "").toUpperCase(),
  });
let sequence = 0;
const next = () => String(++sequence);
async function enroll(org: string, user = "1", role: "admin" | "scout" = "admin") {
  return enrollMember({
    organizationId: org,
    organizationName: "Event tests",
    frcTeamNumber: 1241,
    memberName: "Tester",
    role,
    channel: "telegram",
    externalUserId: user,
  });
}
async function create(org: string, name: string) {
  const result = await changeEvent(org, "1", next(), { kind: "import-frc", config: config(name) });
  assert.equal(result.status, "ok");
  assert.ok(result.eventId);
  return result.eventId;
}
async function cleanup(org: string) {
  await withTenant(org, async (tx) => {
    await cleanupPublished(tx, org);
    for (const table of [
      "raw_entry",
      "intake_rejection",
      "event_command",
      "organization_event_setting",
      "event",
      "channel_identity",
      "member",
    ] as const)
      await tx.deleteFrom(table).where("organization_id", "=", org).execute();
    await tx.deleteFrom("organization").where("id", "=", org).execute();
  });
}
after(() => db.destroy());

test("event changes enforce roles, deduplicate commands and retain tenant/archive invariants", async () => {
  const org = randomUUID(),
    other = randomUUID();
  try {
    await enroll(org);
    await enroll(org, "37021", "scout");
    await enroll(other);
    assert.equal(
      (await changeEvent(org, "37021", next(), { kind: "import-frc", config: config("Denied") }))
        .status,
      "forbidden",
    );
    const createId = next();
    const [a, retry] = await Promise.all([
      changeEvent(org, "1", createId, { kind: "import-frc", config: config("A") }),
      changeEvent(org, "1", createId, { kind: "import-frc", config: config("A") }),
    ]);
    assert.deepEqual(a, retry);
    assert.ok(a.eventId);
    const aid = a.eventId;
    const bid = await create(org, "B"),
      foreign = await create(other, "Foreign");
    assert.equal(
      (await changeEvent(org, "1", next(), { kind: "activate", eventId: foreign })).status,
      "missing",
    );
    assert.equal(
      (await changeEvent(org, "37021", next(), { kind: "activate", eventId: aid })).status,
      "forbidden",
    );
    const activation = next();
    await changeEvent(org, "1", activation, { kind: "activate", eventId: aid });
    assert.equal(
      (await changeEvent(org, "1", next(), { kind: "archive", eventId: aid })).status,
      "active_event",
    );
    await changeEvent(org, "1", next(), { kind: "activate", eventId: bid });
    await changeEvent(org, "1", activation, { kind: "activate", eventId: aid });
    assert.equal(
      (await readEvents(org, "37021"))?.active?.id,
      bid,
      "delayed duplicate activation must not roll back current context",
    );
    await changeEvent(org, "1", next(), { kind: "archive", eventId: aid });
    assert.equal(
      (await changeEvent(org, "1", next(), { kind: "activate", eventId: aid })).status,
      "missing",
    );
    await changeEvent(org, "1", next(), { kind: "restore", eventId: aid });
    await changeEvent(org, "1", next(), {
      kind: "refresh-frc",
      config: { ...config("Renamed"), frcEventCode: "A", attending: false },
    });
    assert.equal((await readEvents(org, "1"))?.events.find((e) => e.id === aid)?.name, "Renamed");
    await assert.rejects(
      withTenant(org, (tx) =>
        tx
          .updateTable("organization_event_setting")
          .set({ active_event_id: foreign })
          .where("organization_id", "=", org)
          .execute(),
      ),
      /foreign key/,
    );
    await assert.rejects(
      withTenant(org, (tx) =>
        tx
          .updateTable("event")
          .set({ archived: true })
          .where("organization_id", "=", org)
          .where("id", "=", bid)
          .execute(),
      ),
      /foreign key/,
    );
    // Verify RLS as a restricted role, then roll the role/grant fixture back.
    await assert.rejects(
      withTenant(org, async (tx) => {
        const role = `event_test_${randomUUID().replaceAll("-", "")}`;
        await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(tx);
        await sql`GRANT USAGE ON SCHEMA public TO ${sql.id(role)}`.execute(tx);
        await sql`GRANT SELECT ON event TO ${sql.id(role)}`.execute(tx);
        await sql`GRANT ${sql.id(role)} TO CURRENT_USER`.execute(tx);
        await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
        const visible = await tx.selectFrom("event").select("id").execute();
        assert.ok(visible.some((e) => e.id === aid));
        assert.equal(
          visible.some((e) => e.id === foreign),
          false,
        );
        throw Error("rollback-rls-fixture");
      }),
      /rollback-rls-fixture/,
    );
  } finally {
    await cleanup(org);
    await cleanup(other);
  }
});

test("sessions bind at intake and follow-ups keep the original event after activation changes", async () => {
  const org = randomUUID();
  try {
    await enroll(org);
    const scout = await enroll(org, "37021", "scout");
    const aid = await create(org, "A"),
      bid = await create(org, "B");
    await changeEvent(org, "1", next(), { kind: "activate", eventId: aid });
    const original = await saveIncomingNote({
      organizationId: org,
      channel: "telegram",
      externalUserId: "37021",
      externalUpdateId: next(),
      text: "Q42 team 1241",
    });
    assert.ok(typeof original === "object");
    await changeEvent(org, "1", next(), { kind: "activate", eventId: bid });
    const pinned = await withTenant(org, (tx) =>
      tx
        .selectFrom("scouting_session")
        .selectAll()
        .where("id", "=", original.sessionId)
        .executeTakeFirstOrThrow(),
    );
    assert.equal(pinned.event_id, aid);
    assert.equal(pinned.member_id, scout);
    assert.equal(pinned.specification_version, "starter-match-v1");
    const claim = await claimExtraction(org);
    assert.ok(claim);
    assert.equal(claim.id, original.sessionId);
    await finishExtraction(
      org,
      claim.id,
      claim.lease,
      stated({ match: "Q42", team_number: 1241, climbed: null, notes: null }),
      "888",
    );
    await changeEvent(org, "1", next(), { kind: "activate", eventId: null });
    const answer = await saveIncomingNote({
      organizationId: org,
      channel: "telegram",
      externalUserId: "37021",
      externalUpdateId: next(),
      text: "no climb",
      replyToMessageId: "888",
    });
    assert.ok(typeof answer === "object");
    assert.equal(answer.sessionId, original.sessionId);
    assert.equal(answer.eventName, "A");
    const resumed = await claimExtraction(org);
    assert.ok(resumed);
    assert.equal(resumed.id, original.sessionId);
    await finishExtraction(
      org,
      resumed.id,
      resumed.lease,
      stated({ match: "Q42", team_number: 1241, climbed: false, notes: null }),
      null,
    );
    const unchanged = await withTenant(org, (tx) =>
      tx
        .selectFrom("scouting_session")
        .select("event_id")
        .where("id", "=", original.sessionId)
        .executeTakeFirstOrThrow(),
    );
    assert.equal(unchanged.event_id, aid);
    await changeEvent(org, "1", next(), { kind: "activate", eventId: bid });
    const delayed = await saveIncomingNote({
      organizationId: org,
      channel: "telegram",
      externalUserId: "37021",
      externalUpdateId: next(),
      text: `/scout ${aid} Q41 team 1241 climbed`,
      eventId: aid,
    });
    assert.ok(typeof delayed === "object");
    assert.equal(delayed.eventName, "A");
    const delayedClaim = await claimExtraction(org);
    assert.ok(delayedClaim);
    assert.equal(delayedClaim.messages[0]?.text, "Q41 team 1241 climbed");
    assert.equal((await readEvents(org, "1"))?.active?.id, bid);
  } finally {
    await cleanup(org);
  }
});

test("new notes require an active event, rejected retries cannot adopt later context, and assignment commands are gone", async () => {
  const org = randomUUID(),
    other = randomUUID();
  try {
    await enroll(org);
    const scout = await enroll(org, "37021", "scout");
    await enroll(other);
    const aid = await create(org, "A"),
      bid = await create(org, "B"),
      foreign = await create(other, "Foreign");
    const app = telegramRoutes("secret");
    const post = async (text: string, updateId = next()) => {
      const response = await app.request("/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "secret",
        },
        body: JSON.stringify({
          update_id: Number(updateId),
          message: { from: { id: 37021 }, chat: { id: 37021, type: "private" }, text },
        }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const rejectedId = next();
    assert.match((await post("Q1 1241 climbed", rejectedId)).text, /no event is active/);
    assert.match((await post(`/scout ${aid} Q1 1241 climbed`)).text, /no event is active/);
    assert.equal(
      (
        await withTenant(org, (tx) =>
          tx.selectFrom("raw_entry").selectAll().where("organization_id", "=", org).execute(),
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await withTenant(org, (tx) =>
          tx
            .selectFrom("scouting_session")
            .selectAll()
            .where("organization_id", "=", org)
            .execute(),
        )
      ).length,
      0,
    );
    await changeEvent(org, "1", next(), { kind: "activate", eventId: aid });
    assert.match((await post("Q1 1241 climbed", rejectedId)).text, /no event is active/);
    const acceptedId = next();
    assert.match((await post("Q1 1241 climbed", acceptedId)).text, /Got it!/);
    assert.match((await post(`/scout ${foreign} Q2 1241 climbed`)).text, /event isn't available/);
    await changeEvent(org, "1", next(), { kind: "archive", eventId: bid });
    assert.match((await post(`/scout ${bid} Q2 1241 climbed`)).text, /event isn't available/);
    assert.match((await post("/eventassign old-session old-event")).text, /\/match <note>/);
    assert.match((await post("/unassigned")).text, /\/match <note>/);
    assert.match((await post("/event")).text, /A/);
    await changeEvent(org, "1", next(), { kind: "activate", eventId: null });
    assert.deepEqual(
      await post("Q1 1241 climbed", acceptedId),
      { ok: true },
      "accepted retries remain duplicates after the active event is cleared",
    );
    assert.match((await post("Q3 1241 climbed")).text, /no event is active/);
    const existing = await claimExtraction(org);
    assert.ok(
      existing,
      "previously accepted sessions continue independently of active-event changes",
    );
    const legacy = await withTenant(org, (tx) =>
      tx
        .insertInto("raw_entry")
        .values({
          organization_id: org,
          member_id: scout,
          channel: "telegram",
          external_update_id: next(),
          text: "Historical Q4 note",
          status: "needs_review",
          follow_up_message_id: "legacy-question",
        })
        .returning("id")
        .executeTakeFirstOrThrow(),
    );
    assert.equal(
      await saveIncomingNote({
        organizationId: org,
        channel: "telegram",
        externalUserId: "37021",
        externalUpdateId: next(),
        text: "late answer",
        replyToMessageId: "legacy-question",
      }),
      "legacy_session",
    );
    const rows = await withTenant(org, (tx) =>
      tx.selectFrom("raw_entry").selectAll().where("organization_id", "=", org).execute(),
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.id === legacy.id));
    const rejections = await withTenant(org, (tx) =>
      tx.selectFrom("intake_rejection").selectAll().where("organization_id", "=", org).execute(),
    );
    assert.ok(rejections.length > 0);
    assert.ok(rejections.every((r) => !("text" in r)));
  } finally {
    await cleanup(org);
    await cleanup(other);
  }
});

test("FRC event selection imports once, preserves settings, and deduplicates activation", async () => {
  const org = randomUUID();
  try {
    await enroll(org);
    await enroll(org, "37021", "scout");
    let lookups = 0;
    const lookup = async (season: number, code: string) => {
      lookups++;
      return parseEventConfig({
        ...config("Imported FIRST event"),
        season,
        frcEventCode: code,
        source: "frc_events",
      });
    };
    const input = (text: string, userId = "1", updateId = next()) => ({
      organizationId: org,
      userId,
      updateId,
      text,
    });
    assert.match(
      (await eventCommand(input("/event set 2026 ONOSH", "37021"), lookup)) ?? "",
      /Only team admins/,
    );
    assert.equal(lookups, 0);
    const updateId = next();
    assert.match(
      (await eventCommand(input("/event set 2026 onosh", "1", updateId), lookup)) ?? "",
      /Imported FIRST event/,
    );
    const first = (await readEvents(org, "1"))?.active;
    assert.ok(first);
    assert.equal(first.frc_event_code, "ONOSH");
    const note = await saveIncomingNote({
      organizationId: org,
      channel: "telegram",
      externalUserId: "1",
      externalUpdateId: next(),
      text: "Q1 1241 climbed",
    });
    assert.ok(typeof note === "object");
    // An existing organization setting must survive both selection and refresh.
    await withTenant(org, (tx) =>
      tx.updateTable("event").set({ attending: true }).where("id", "=", first.id).execute(),
    );
    assert.match(
      (await eventCommand(input("/event set 2026 ONOSH"), lookup)) ?? "",
      /Imported FIRST event/,
    );
    assert.equal(lookups, 1, "cached selection should not need another API request");
    assert.equal((await readEvents(org, "1"))?.events.length, 1);
    const other = await create(org, "Other");
    await changeEvent(org, "1", next(), { kind: "activate", eventId: other });
    await eventCommand(input("/event set 2026 ONOSH", "1", updateId), lookup);
    assert.equal(
      (await readEvents(org, "1"))?.active?.id,
      other,
      "duplicate import command cannot replace a newer active event",
    );
    const refreshed = async (season: number, code: string) => {
      lookups++;
      return parseEventConfig({
        ...config("Updated by FIRST"),
        season,
        frcEventCode: code,
        timezone: "America/New_York",
      });
    };
    assert.match(
      (await eventCommand(input("/event refresh 2026 ONOSH"), refreshed)) ?? "",
      /Updated .* from FIRST/,
    );
    const refreshedRow = (await readEvents(org, "1"))?.events.find((e) => e.id === first.id);
    assert.equal(refreshedRow?.name, "Updated by FIRST");
    assert.equal(refreshedRow?.attending, true);
    const pinned = await withTenant(org, (tx) =>
      tx
        .selectFrom("scouting_session")
        .selectAll()
        .where("id", "=", note.sessionId)
        .executeTakeFirstOrThrow(),
    );
    assert.equal(pinned.event_id, first.id);
    assert.equal(pinned.specification_version, "starter-match-v1");
    assert.equal((await readEvents(org, "1"))?.active?.id, other);
    assert.match((await eventCommand(input("/event add 2026 ONNEW"), lookup)) ?? "", /Event added/);
    assert.equal((await readEvents(org, "1"))?.active?.id, other);
    await changeEvent(org, "1", next(), { kind: "archive", eventId: first.id });
    assert.match(
      (await eventCommand(input("/event set 2026 ONOSH"), lookup)) ?? "",
      /isn't available/,
    );
    assert.equal((await readEvents(org, "1"))?.active?.id, other);
    const failing = async () => {
      throw new (await import("./frc-events.ts")).FrcEventsError("FIRST lookup failed");
    };
    assert.match(
      (await eventCommand(input("/event set 2026 NOTFOUND"), failing)) ?? "",
      /lookup failed/,
    );
    assert.equal((await readEvents(org, "1"))?.active?.id, other);
  } finally {
    await cleanup(org);
  }
});

test("event creation persists automatic TBA links, retries missing links on refresh, preserves manual links and deduplicates discovery", async () => {
  const org = randomUUID();
  try {
    await enroll(org);
    let lookups = 0;
    const discover = async () => {
      lookups++;
      return "2026auto";
    };
    const action = { kind: "import-frc" as const, config: config("Auto") };
    const update = next();
    const created = await changeEvent(org, "1", update, action, discover);
    assert.equal(created.status, "ok");
    assert.ok(created.eventId);
    assert.equal(created.tbaEventKey, "2026auto");
    assert.deepEqual(await changeEvent(org, "1", update, action, discover), created);
    assert.equal(lookups, 1);
    const refresh = { kind: "refresh-frc" as const, config: action.config };
    await changeEvent(org, "1", next(), refresh, async () => {
      throw new Error("existing links must not be rediscovered");
    });
    assert.equal(
      (await readEvents(org, "1"))?.events.find((e) => e.id === created.eventId)?.tba_event_key,
      "2026auto",
    );
    const unlinked = await changeEvent(
      org,
      "1",
      next(),
      { kind: "import-frc", config: config("Pending") },
      async () => null,
    );
    assert.equal(unlinked.status, "ok");
    assert.equal(unlinked.tbaEventKey, null);
    const linked = await changeEvent(
      org,
      "1",
      next(),
      { kind: "refresh-frc", config: config("Pending") },
      async () => "2026pending",
    );
    assert.equal(linked.tbaEventKey, "2026pending");
    const manual = await changeEvent(
      org,
      "1",
      next(),
      { kind: "import-frc", config: { ...config("Manual"), tbaEventKey: "2026manual" } },
      async () => {
        throw new Error("manual link must win");
      },
    );
    assert.equal(manual.tbaEventKey, "2026manual");
    const conflict = await changeEvent(
      org,
      "1",
      next(),
      { kind: "import-frc", config: config("Conflict") },
      discover,
    );
    assert.equal(conflict.status, "ok");
    assert.equal(conflict.tbaEventKey, null);
    assert.equal(
      (
        await changeEvent(org, "unauthorized", next(), action, async () => {
          throw new Error("unauthorized discovery");
        })
      ).status,
      "forbidden",
    );
  } finally {
    await cleanup(org);
  }
});
