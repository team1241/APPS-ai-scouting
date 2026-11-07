import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { db } from "./db.ts";
import { eventCommand } from "./event-commands.ts";
import { parseEventConfig } from "./event-config.ts";
import type { ReferenceProvider } from "./reference-provider.ts";
import { changeEvent } from "./repositories/events.ts";
import {
  claimExtraction,
  failExtraction,
  finishExtraction,
  recordExtractionQuestion,
} from "./repositories/extraction.ts";
import { saveIncomingNote } from "./repositories/intake.ts";
import { enrollMember } from "./repositories/members.ts";
import { overrideReference, readReference, syncReference } from "./repositories/reference.ts";
import { withTenant } from "./repositories/tenant.ts";
import { runScheduleJob } from "./schedule-job.ts";

let seq = 10000;
const next = () => String(++seq);
const participants = ["Red1", "Red2", "Red3", "Blue1", "Blue2", "Blue3"].map((station, i) => ({
  station,
  number: 1241 + i,
  surrogate: false,
}));
const provider: ReferenceProvider = {
  source: "frc_events",
  load: async () => ({
    complete: true,
    teams: participants.map((p) => ({
      number: p.number,
      name: null,
      city: null,
      region: null,
      country: null,
    })),
    matches: [
      {
        key: "qm:1",
        stage: "qualification",
        round: "qm",
        set: 1,
        number: 1,
        scheduled: null,
        predicted: null,
        actual: null,
        completed: null,
        participants,
        result: null,
      },
      {
        key: "first:playoff:14",
        stage: "playoff",
        round: "final",
        set: 1,
        number: 14,
        scheduled: null,
        predicted: null,
        actual: null,
        completed: null,
        participants,
        result: null,
      },
    ],
  }),
};
after(() => db.destroy());
async function fixture(run: (org: string, event: string) => Promise<void>) {
  const org = randomUUID();
  try {
    for (const user of ["1", "2"])
      await enrollMember({
        organizationId: org,
        organizationName: "Participation tests",
        frcTeamNumber: 1241,
        memberName: user,
        role: user === "1" ? "admin" : "scout",
        channel: "telegram",
        externalUserId: user,
      });
    const created = await changeEvent(org, "1", next(), {
      kind: "activate-frc",
      config: parseEventConfig({
        name: "Participation",
        season: 2026,
        type: "offseason",
        startDate: "2026-11-01",
        endDate: "2026-11-02",
        timezone: "America/Toronto",
        source: "frc_events",
        frcEventCode: "GH3",
        tbaEventKey: "2026gh3",
      }),
    });
    assert.ok(created.eventId);
    await run(org, created.eventId);
  } finally {
    await withTenant(org, async (tx) => {
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
}
async function note(org: string, user = "1", reply?: string, text = "Q1 team 1241") {
  const saved = await saveIncomingNote({
    organizationId: org,
    channel: "telegram",
    externalUserId: user,
    externalUpdateId: next(),
    text,
    replyToMessageId: reply,
  });
  assert.equal(typeof saved, "object");
  if (typeof saved !== "object") throw Error("not saved");
  return saved.sessionId;
}
async function finish(
  org: string,
  team: number | null = 1241,
  climbed: boolean | null = false,
  match: string | null = "Q1",
) {
  const claimed = await claimExtraction(org);
  assert.ok(claimed);
  const question = next();
  const saved = await finishExtraction(
    org,
    claimed.id,
    claimed.lease,
    finalizeExtraction({ match, team_number: team, climbed, notes: null }),
    question,
  );
  return { id: claimed.id, question, ...saved };
}
async function mode(org: string, event: string, value: "off" | "warn" | "strict") {
  assert.equal(
    (await changeEvent(org, "1", next(), { kind: "validation", eventId: event, mode: value }))
      .status,
    "ok",
  );
}

test("strict preserves intake, handles missing/stale schedules, and finalizes exact participants including playoffs", async () =>
  fixture(async (org, event) => {
    await mode(org, event, "strict");
    const id = await note(org);
    let saved = await finish(org);
    assert.equal(saved.id, id);
    assert.equal(saved.result.status, "needs_review");
    assert.match(saved.result.question ?? "", /No schedule/);
    await syncReference(org, "1", event, provider);
    await note(org, "1", saved.question);
    saved = await finish(org, 9999);
    assert.equal(saved.result.status, "needs_review");
    assert.match(saved.result.question ?? "", /not scheduled/);
    const deliveredQuestion = saved.question;
    await note(org, "1", deliveredQuestion);
    saved = await finish(org);
    assert.equal(saved.result.status, "complete");
    const replay = await saveIncomingNote({
      organizationId: org,
      channel: "telegram",
      externalUserId: "1",
      externalUpdateId: next(),
      text: "correction",
      replyToMessageId: deliveredQuestion,
    });
    assert.equal(replay, "completed_session");
    for (const p of participants) {
      await note(org);
      assert.equal((await finish(org, p.number, false, "P14")).result.status, "complete");
    }
    await syncReference(org, "1", event, {
      ...provider,
      load: async () => {
        throw Error("unavailable");
      },
    });
    await note(org);
    saved = await finish(org);
    assert.match(saved.result.question ?? "", /unverified|incomplete\/failed/);
    await withTenant(org, async (tx) => {
      const rows = await tx
        .selectFrom("raw_entry")
        .selectAll()
        .where("organization_id", "=", org)
        .execute();
      assert.ok(rows.some((r) => r.id === id && r.text === "Q1 team 1241"));
    });
  }));

test("warn permits explicit unverified save; off bypasses checks; only admins can set modes", async () =>
  fixture(async (org, event) => {
    assert.equal(
      (await changeEvent(org, "2", next(), { kind: "validation", eventId: event, mode: "off" }))
        .status,
      "forbidden",
    );
    await note(org);
    const saved = await finish(org);
    assert.match(saved.result.question ?? "", /save unverified/);
    await note(org, "1", saved.question, "save unverified");
    assert.equal((await finish(org)).result.status, "complete");
    await mode(org, event, "off");
    await note(org);
    assert.equal((await finish(org)).result.status, "complete");
    assert.match(
      (await eventCommand({
        organizationId: org,
        userId: "1",
        updateId: next(),
        text: "/event",
      })) ?? "",
      /Schedule validation: off/,
    );
  }));

test("provisional sessions, separate scouts and multiple teams remain independent; same-target notes require explicit choice", async () =>
  fixture(async (org, event) => {
    await syncReference(org, "1", event, provider);
    const a = await note(org);
    const b = await note(org);
    assert.notEqual(a, b);
    assert.equal((await finish(org, null, null, null)).result.status, "needs_review");
    const first = await finish(org, 1241, null);
    await note(org);
    const conflict = await finish(org, 1241, null);
    assert.match(conflict.result.question ?? "", /Another open session/);
    assert.notEqual(conflict.id, first.id);
    const context = await eventCommand({
      organizationId: org,
      userId: "1",
      updateId: next(),
      text: "/event",
    });
    assert.match(context ?? "", /separate-note decision needed/);
    assert.ok(context?.includes(event));
    await note(org, "1", conflict.question, "keep separate");
    const independent = await finish(org, 1241, null);
    assert.equal(independent.result.status, "needs_review");
    assert.doesNotMatch(independent.result.question ?? "", /Another open session/);
    await note(org, "1", independent.question, "No climb");
    assert.equal((await finish(org)).result.status, "complete");
    await note(org, "2");
    assert.equal((await finish(org)).result.status, "complete");
    await note(org);
    assert.equal((await finish(org, 1242)).result.status, "complete");
    await note(org, "1", first.question, "They did not climb");
    assert.equal(
      (await finish(org)).result.status,
      "complete",
      "older open session is not blocked by a newer independent note",
    );
  }));

test("switching or clearing active events between question and reply preserves original validation scope", async () =>
  fixture(async (org, event) => {
    await syncReference(org, "1", event, provider);
    await mode(org, event, "strict");
    const id = await note(org);
    const first = await finish(org, 1241, null);
    const second = await changeEvent(org, "1", next(), {
      kind: "activate-frc",
      config: parseEventConfig({
        name: "Other",
        season: 2026,
        type: "offseason",
        startDate: "2026-11-03",
        endDate: "2026-11-04",
        timezone: "America/Toronto",
        source: "frc_events",
        frcEventCode: "OTHER",
        tbaEventKey: "2026other",
      }),
    });
    assert.ok(second.eventId);
    assert.equal(await note(org, "1", first.question, "No climb"), id);
    assert.equal((await finish(org)).result.status, "complete");
    await withTenant(org, async (tx) => {
      const session = await tx
        .selectFrom("scouting_session")
        .selectAll()
        .where("organization_id", "=", org)
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      assert.equal(session.event_id, event);
      assert.ok(session.match_id);
    });
  }));

test("question delivery retries retain validation and a concurrent reply invalidates an older extraction lease", async () =>
  fixture(async (org, event) => {
    await mode(org, event, "strict");
    const id = await note(org);
    const claimed = await claimExtraction(org);
    assert.ok(claimed);
    const complete = finalizeExtraction({
      match: "Q1",
      team_number: 1241,
      climbed: false,
      notes: null,
    });
    const saved = await finishExtraction(org, id, claimed.lease, complete, null);
    assert.equal(saved.result.status, "needs_review");
    await failExtraction(org, id, claimed.lease);
    await withTenant(org, async (tx) => {
      const raw = await tx
        .selectFrom("raw_entry")
        .selectAll()
        .where("organization_id", "=", org)
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      assert.equal(raw.status, "failed");
      assert.ok(raw.extraction_result);
      await tx
        .updateTable("raw_entry")
        .set({ next_attempt_at: new Date(0) })
        .where("organization_id", "=", org)
        .where("id", "=", id)
        .execute();
    });
    const retry = await claimExtraction(org);
    assert.ok(retry);
    await finishExtraction(org, id, retry.lease, complete, null);
    await recordExtractionQuestion(org, id, retry.lease, "delivered");
    await note(org, "1", "delivered", "More details");
    const older = await claimExtraction(org);
    assert.ok(older);
    await note(org, "1", "delivered", "Corrected team 1242");
    assert.equal((await finishExtraction(org, id, older.lease, complete, null)).numUpdatedRows, 0n);
    const current = await claimExtraction(org);
    assert.ok(current);
    assert.equal(current.id, id);
    assert.match(current.text, /Corrected team 1242/);
  }));

test("validation uses primary participants despite supplemental conflicts or time overrides, with event-scoped match foreign keys", async () =>
  fixture(async (org, event) => {
    await mode(org, event, "strict");
    await syncReference(org, "1", event, provider);
    await syncReference(org, "1", event, {
      source: "tba",
      load: async () => {
        const snapshot = await provider.load(2026, "GH3");
        return {
          ...snapshot,
          matches: snapshot.matches.map((m) => ({
            ...m,
            participants: m.participants.map((p) => ({ ...p, number: p.number + 10000 })),
          })),
        };
      },
    });
    await note(org);
    assert.equal((await finish(org)).result.status, "complete");
    const reference = await readReference(org, "1", event);
    const match = reference.matches.find((m) => m.key === "qm:1");
    assert.ok(match);
    await overrideReference(org, "1", event, "match", match.id, {
      scheduled: "2026-11-01T12:00:00",
    });
    await note(org);
    const invalid = await finish(org, 11241);
    assert.match(invalid.result.question ?? "", /not scheduled/);
    await note(org, "1", invalid.question, "Team 1241");
    assert.equal((await finish(org)).result.status, "complete");
    const other = await changeEvent(org, "1", next(), {
      kind: "import-frc",
      config: parseEventConfig({
        name: "Foreign match",
        season: 2026,
        type: "offseason",
        startDate: "2026-11-03",
        endDate: "2026-11-04",
        timezone: "America/Toronto",
        source: "frc_events",
        frcEventCode: "FOREIGN",
        tbaEventKey: "2026foreign",
      }),
    });
    assert.ok(other.eventId);
    await syncReference(org, "1", other.eventId, provider);
    const foreign = (await readReference(org, "1", other.eventId)).matches[0];
    assert.ok(foreign);
    await assert.rejects(
      withTenant(org, (tx) =>
        tx
          .updateTable("scouting_session")
          .set({ match_id: foreign.id })
          .where("organization_id", "=", org)
          .where("id", "=", invalid.id)
          .execute(),
      ),
      /session_match_event_fk/,
    );
  }));

test("automatically acquired rosters and schedules validate; legacy roster backfill never refetches saved matches", async () =>
  fixture(async (org, event) => {
    await mode(org, event, "strict");
    let scheduleCalls = 0,
      rosterCalls = 0;
    const acquisition: ReferenceProvider = {
      source: "frc_events",
      load: async () => {
        scheduleCalls++;
        return provider.load(2026, "GH3");
      },
      loadRoster: async () => {
        rosterCalls++;
        return { ...(await provider.load(2026, "GH3")), matches: [] };
      },
    };
    const options = {
      now: new Date("2026-11-08T00:00:00Z"),
      providers: { first: acquisition, tba: acquisition },
      fetcher: (async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
    };
    assert.equal((await runScheduleJob(org, "mock", options)).received, 1);
    await note(org);
    assert.equal((await finish(org)).result.status, "complete");
    const before = await readReference(org, "1", event);
    assert.equal(before.teams.length, 6);
    assert.ok(before.schedulePoll?.roster_received_at);
    await withTenant(org, (tx) =>
      tx
        .updateTable("schedule_poll")
        .set({ roster_received_at: null })
        .where("organization_id", "=", org)
        .where("event_id", "=", event)
        .execute(),
    );
    const later = { ...options, now: new Date("2026-11-08T00:10:00Z") };
    assert.equal((await runScheduleJob(org, "mock", later)).received, 1);
    assert.equal(scheduleCalls, 1);
    assert.equal(rosterCalls, 1);
    const after = await readReference(org, "1", event);
    assert.deepEqual(after.matches, before.matches);
    assert.deepEqual(after.schedulePoll?.received_at, before.schedulePoll?.received_at);
    await note(org);
    assert.equal((await finish(org)).result.status, "complete");
    assert.equal(
      (await runScheduleJob(org, "mock", { ...options, now: new Date("2026-11-08T00:20:00Z") }))
        .attempted,
      0,
    );
  }));
