import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { sql } from "kysely";
import { db } from "./db.ts";
import { eventCommand } from "./event-commands.ts";
import { parseEventConfig } from "./event-config.ts";
import { cleanupPublished } from "./published-test-cleanup.ts";
import type { ReferenceProvider } from "./reference-provider.ts";
import { changeEvent } from "./repositories/events.ts";
import { claimExtraction, failExtraction, finishExtraction } from "./repositories/extraction.ts";
import { saveIncomingNote } from "./repositories/intake.ts";
import { enrollMember } from "./repositories/members.ts";
import { claimDelivery, settleDelivery } from "./repositories/outbound.ts";
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
    const { readObservationHistory } = await import("./repositories/observations.ts");
    const records = await readObservationHistory(org, "1");
    assert.equal(records[0]?.outcome, "warning_acknowledged");
    assert.equal(records[0]?.validCoverage, false);
    assert.ok(records[0]);
    assert.equal((records[0].provenance as { rawEntryIds: string[] }).rawEntryIds.length, 2);
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
      assert.equal(raw.status, "needs_review");
      assert.ok(raw.extraction_result);
      await tx
        .updateTable("raw_entry")
        .set({ next_attempt_at: new Date(0) })
        .where("organization_id", "=", org)
        .where("id", "=", id)
        .execute();
    });
    assert.equal(await claimExtraction(org), null);
    const delivery = await claimDelivery(org);
    assert.ok(delivery && !delivery.cancelled);
    await settleDelivery(org, delivery.id, delivery.lease_token, {
      status: "sent",
      messageId: "delivered",
    });
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

test("published versions survive selection changes; finalization is concurrent and immutable", async () =>
  fixture(async (org, event) => {
    const { requirements } = await import("@ai-scouting/scouting");
    const { publishSpecification, selectSpecification, readObservationHistory } = await import(
      "./repositories/observations.ts"
    );
    await mode(org, event, "off");
    const original = await note(org);
    const first = await finish(org, 1241, null);
    const v2 = {
      ...requirements,
      version: "test-v2",
      fields: [
        ...requirements.fields,
        {
          key: "extra",
          type: "boolean" as const,
          required: true,
          description: "Practice",
          question: "Extra?",
        },
      ],
    };
    await assert.rejects(publishSpecification(org, "2", 2026, "match", v2), /Forbidden/);
    await publishSpecification(org, "1", 2026, "match", v2);
    await assert.rejects(publishSpecification(org, "1", 2026, "match", v2), /duplicate/);
    await selectSpecification(org, "1", event, v2.version);
    await note(org, "1", first.question, "no climb");
    const claim = await claimExtraction(org);
    assert.ok(claim);
    assert.equal(claim.id, original);
    assert.equal(claim.specification.version, requirements.version);
    const complete = finalizeExtraction(
      { match: "Q1", team_number: 1241, climbed: false, notes: null },
      claim.specification,
    );
    const results = await Promise.all([
      finishExtraction(org, claim.id, claim.lease, complete, null),
      finishExtraction(org, claim.id, claim.lease, complete, null),
    ]);
    assert.equal(results.filter((r) => r.numUpdatedRows === 1n).length, 1);
    let history = await readObservationHistory(org, "1");
    assert.equal(history.length, 1);
    assert.equal(history[0]?.outcome, "unchecked");
    assert.equal(history[0]?.validCoverage, false);
    await assert.rejects(
      withTenant(org, (tx) =>
        tx
          .updateTable("observation_revision")
          .set({ team_number: 999 })
          .where("organization_id", "=", org)
          .execute(),
      ),
      /immutable/,
    );
    await assert.rejects(
      withTenant(org, (tx) =>
        tx
          .updateTable("published_specification")
          .set({ document: "{}" })
          .where("organization_id", "=", org)
          .execute(),
      ),
      /immutable/,
    );
    await note(org);
    const newer = await claimExtraction(org);
    assert.ok(newer);
    assert.equal(newer.specification.version, "test-v2");
    const incomplete = finalizeExtraction(
      { match: "Q1", team_number: 1241, climbed: false, notes: null, extra: null },
      newer.specification,
    );
    assert.equal(
      (await finishExtraction(org, newer.id, newer.lease, incomplete, "v2question")).result.status,
      "needs_review",
    );
    history = await readObservationHistory(org, "1");
    assert.equal(history.length, 1);
  }));

test("corrections retain history and original event, deny foreign/stale targets, and explicit re-extraction creates a new revision", async () =>
  fixture(async (org, event) => {
    const { readObservationHistory } = await import("./repositories/observations.ts");
    await syncReference(org, "1", event, provider);
    await mode(org, event, "strict");
    await note(org);
    await finish(org);
    let history = await readObservationHistory(org, "1");
    const original = history[0];
    assert.ok(original);
    assert.equal(original.validCoverage, true);
    await changeEvent(org, "1", next(), { kind: "activate", eventId: null });
    const correction = async (target: string, user = "1", reextract = false) =>
      saveIncomingNote({
        organizationId: org,
        channel: "telegram",
        externalUserId: user,
        externalUpdateId: next(),
        text: "Q1 team 1242 no climb",
        correctionRevisionId: target,
        reextract,
      });
    assert.equal(await correction(original.id, "2"), "completed_session");
    assert.equal((await readObservationHistory(org, "2")).length, 0);
    await fixture(async (other) => {
      assert.equal(
        await saveIncomingNote({
          organizationId: other,
          channel: "telegram",
          externalUserId: "1",
          externalUpdateId: next(),
          text: "foreign correction",
          correctionRevisionId: original.id,
        }),
        "completed_session",
      );
    });
    assert.equal(await correction(randomUUID()), "completed_session");
    const a = await correction(original.id),
      b = await correction(original.id);
    assert.equal(typeof a, "object");
    assert.equal(typeof b, "object");
    const invalid = await finish(org, 9999);
    assert.equal(invalid.result.status, "needs_review");
    await note(org, "1", invalid.question, "team 1242");
    // The second independent correction can finish first. The stale contender cannot replace it.
    await finish(org, 1242);
    assert.match((await finish(org, 1242)).result.question ?? "", /no longer current/);
    history = await readObservationHistory(org, "1");
    assert.equal(history.length, 2);
    assert.equal(history.filter((r) => r.current).length, 1);
    const current = history.find((r) => r.current);
    assert.ok(current);
    assert.equal(current.replaces_revision_id, original.id);
    assert.equal(current.event_id, event);
    assert.equal(await correction(original.id), "completed_session");
    assert.equal(typeof (await correction(current.id, "1", true)), "object");
    // Skip the stale failed contender when claiming the explicit re-extraction.
    const pending = await claimExtraction(org);
    assert.ok(pending);
    assert.match(pending.text, /explicitReextractionOf/);
    await finishExtraction(
      org,
      pending.id,
      pending.lease,
      finalizeExtraction({ match: "Q1", team_number: 1242, climbed: false, notes: null }),
      null,
    );
    history = await readObservationHistory(org, "1");
    assert.equal(history.length, 3);
    assert.equal(history.filter((r) => r.current).length, 1);
    assert.ok(history.every((r) => r.event_id === event));
  }));

test("ambiguous question receipts never select an arbitrary session", async () =>
  fixture(async (org) => {
    await note(org);
    await note(org);
    await withTenant(org, (tx) =>
      tx
        .updateTable("raw_entry")
        .set({ follow_up_message_id: "ambiguous" })
        .where("organization_id", "=", org)
        .execute(),
    );
    assert.equal(
      await saveIncomingNote({
        organizationId: org,
        channel: "telegram",
        externalUserId: "1",
        externalUpdateId: next(),
        text: "no climb",
        replyToMessageId: "ambiguous",
      }),
      "completed_session",
    );
  }));

test("flag requests preserve observations, deduplicate concurrent retries, and are visible to enrolled teammates only", async () =>
  fixture(async (org, event) => {
    const { submitObservationFlag, readObservationFlags } = await import("./repositories/flags.ts");
    const { readObservationHistory } = await import("./repositories/observations.ts");
    const { telegramCommand } = await import("./telegram-commands.ts");
    await mode(org, event, "off");
    const flag = (argument: string, updateId = next(), userId = "1") =>
      submitObservationFlag({
        organizationId: org,
        userId,
        updateId,
        argument,
        commandText: `/flag ${argument}`,
      });
    assert.equal((await flag("1241")).status, "missing");
    assert.equal((await flag("1241", next(), "unknown")).status, "forbidden");
    await note(org);
    await finish(org);
    const before = await readObservationHistory(org, "1");
    assert.ok(before[0]);
    const updateId = next();
    const results = await Promise.all([
      flag("1241 1 Wrong climb", updateId),
      flag("1241 1 Wrong climb", updateId),
    ]);
    assert.ok(results.every((r) => r.status === "saved"));
    assert.equal(results.filter((r) => r.status === "saved" && !r.duplicate).length, 1);
    const first = await readObservationFlags(org, "2");
    assert.ok(first);
    assert.equal(first.length, 1);
    assert.equal(first[0]?.revision_id, before[0].id);
    assert.equal(first[0]?.note, "Wrong climb");
    assert.equal(first[0]?.command_text, "/flag 1241 1 Wrong climb");
    assert.deepEqual(await readObservationHistory(org, "1"), before);
    await assert.rejects(
      withTenant(org, (tx) =>
        tx
          .updateTable("observation_flag")
          .set({ note: "overwrite" })
          .where("organization_id", "=", org)
          .execute(),
      ),
      /immutable/,
    );

    assert.equal(
      (await flag("1241", next(), "2")).status,
      "missing",
      "a teammate may investigate, but cannot silently flag another scout’s latest submission",
    );
    assert.equal(await readObservationFlags(org, "unknown"), null);
    await fixture(async (other) => {
      assert.deepEqual(await readObservationFlags(other, "1"), []);
      assert.deepEqual(await readObservationFlags(other, "1", first[0]?.id), []);
      await assert.rejects(
        withTenant(other, async (tx) => {
          const role = `flag_test_${randomUUID().replaceAll("-", "")}`;
          await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(tx);
          await sql`GRANT USAGE ON SCHEMA public TO ${sql.id(role)}`.execute(tx);
          await sql`GRANT SELECT,INSERT ON observation_flag TO ${sql.id(role)}`.execute(tx);
          await sql`GRANT ${sql.id(role)} TO CURRENT_USER`.execute(tx);
          await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
          assert.deepEqual(await tx.selectFrom("observation_flag").selectAll().execute(), []);
          assert.ok(first[0]);
          await tx
            .insertInto("observation_flag")
            .values({
              organization_id: org,
              revision_id: first[0].revision_id,
              member_id: first[0].member_id,
              external_update_id: next(),
              team_number: 1241,
              command_text: "forbidden",
            })
            .execute();
        }),
        /row-level security/,
      );
    });
    const command = (text: string, userId = "1") =>
      telegramCommand({ organizationId: org, userId, updateId: next(), text, name: "Scout" });
    assert.match((await command("/flags", "2")) ?? "", /Team 1241/);
    assert.match((await command(`/flags ${first[0]?.id}`, "2")) ?? "", /Wrong climb/);
    assert.match((await command("/correct ignored")) ?? "", /\/flag/);
    assert.match((await command("/flag")) ?? "", /Use \/flag/);
    // Clearing the event does not retarget flags; new submissions require explicit activation.
    await changeEvent(org, "1", next(), { kind: "activate", eventId: null });
    const noActive = await flag("1241");
    assert.equal(noActive.status, "saved");
    if (noActive.status === "saved") assert.equal(noActive.flag.revision_id, before[0].id);
    await changeEvent(org, "1", next(), { kind: "activate", eventId: event });
    await note(org);
    await finish(org);
    assert.equal(
      (await flag("1241 1")).status,
      "ambiguous",
      "independent finalized notes must not be silently selected by explicit match",
    );
    const latest = await flag("1241 Need review");
    assert.equal(latest.status, "saved");
    if (latest.status === "saved") assert.notEqual(latest.flag.revision_id, before[0].id);
    const replay = await flag("1241 1 Changed retry text", updateId);
    assert.equal(replay.status, "saved");
    if (replay.status === "saved") {
      assert.equal(replay.flag.revision_id, before[0].id);
      assert.equal(replay.flag.note, "Wrong climb");
    }
    assert.equal((await flag("9999")).status, "missing");
    assert.equal((await flag("1241 999")).status, "missing");
    const routed = await (await import("./telegram.ts"))
      .telegramRoutes(org, "secret")
      .request("/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "secret",
        },
        body: JSON.stringify({
          update_id: Number(next()),
          message: {
            chat: { id: 1, type: "private" },
            from: { id: 1 },
            text: "/flag 1241 Routing test",
          },
        }),
      });
    assert.match(((await routed.json()) as { text: string }).text, /Flag recorded/);
    const route = (await import("./telegram.ts")).telegramRoutes(org, "secret");
    for (const text of [
      `/reextract ${before[0].id}`,
      `/REEXTRACT@scouting_bot ${before[0].id}`,
      "/reextract invalid",
      `/correct ${before[0].id} replacement`,
    ]) {
      const retired = await route.request("/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "secret",
        },
        body: JSON.stringify({
          update_id: Number(next()),
          message: { chat: { id: 1, type: "private" }, from: { id: 1 }, text },
        }),
      });
      const reply = (await retired.json()) as { text: string };
      assert.match(reply.text, /use \/flag/);
      assert.doesNotMatch(reply.text, /Received your scouting note/);
      assert.equal(
        await claimExtraction(org),
        null,
        "retired commands must not start extraction or a replacement session",
      );
    }

    const replacement = await saveIncomingNote({
      organizationId: org,
      channel: "telegram",
      externalUserId: "1",
      externalUpdateId: next(),
      text: "/reextract",
      correctionRevisionId: before[0].id,
      reextract: true,
    });
    assert.equal(typeof replacement, "object");
    await finish(org);
    const retained = await readObservationFlags(org, "2", first[0]?.id);
    assert.equal(retained?.[0]?.revision_id, before[0].id);
    assert.equal(retained?.[0]?.revision_current, false);
    assert.equal(await claimExtraction(org), null, "flagging never queues extraction work");
  }));

test("an accepted question with lost delivery persistence routes by its reference after scouting is paused", async () =>
  fixture(async (org, event) => {
    await mode(org, event, "off");
    const id = await note(org);
    const claim = await claimExtraction(org);
    assert.ok(claim);
    await finishExtraction(
      org,
      id,
      claim.lease,
      finalizeExtraction({ match: "Q1", team_number: 1241, climbed: null, notes: null }),
      null,
    );
    const delivery = await claimDelivery(org);
    assert.ok(delivery && !delivery.cancelled);
    // Simulate Telegram accepting, then process loss before recording message_id.
    await claimDelivery(org, new Date(Date.now() + 120000));
    await withTenant(org, (tx) =>
      tx
        .updateTable("organization_event_setting")
        .set({ active_event_id: null })
        .where("organization_id", "=", org)
        .execute(),
    );
    const reply = await saveIncomingNote({
      organizationId: org,
      channel: "telegram",
      externalUserId: "1",
      externalUpdateId: next(),
      text: "No climb",
      replyToMessageId: "unrecorded",
      replyDeliveryId: delivery.id,
    });
    assert.equal(typeof reply, "object");
    if (typeof reply === "object") assert.equal(reply.sessionId, id);
    const resumed = await claimExtraction(org);
    assert.ok(resumed);
    assert.equal(resumed.id, id);
    const completed = finalizeExtraction({
      match: "Q1",
      team_number: 1241,
      climbed: false,
      notes: null,
    });
    await finishExtraction(org, id, resumed.lease, completed, null);
    const confirmation = await claimDelivery(org);
    assert.ok(confirmation && !confirmation.cancelled);
    await settleDelivery(org, confirmation.id, confirmation.lease_token, {
      status: "failed",
      error: "Telegram rejection 403",
    });
    assert.equal(await claimExtraction(org), null);
    assert.equal(
      (await finishExtraction(org, id, resumed.lease, completed, null)).numUpdatedRows,
      0n,
    );
    const revisions = await withTenant(org, (tx) =>
      tx
        .selectFrom("observation_revision")
        .select("id")
        .where("organization_id", "=", org)
        .where("session_id", "=", id)
        .execute(),
    );
    assert.equal(revisions.length, 1);
  }));
