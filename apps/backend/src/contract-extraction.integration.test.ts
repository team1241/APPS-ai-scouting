import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { type ObservationKind, readContract } from "@ai-scouting/scouting";
import generalDocument from "@ai-scouting/scouting/examples/general.json" with { type: "json" };
import matchDocument from "@ai-scouting/scouting/examples/match.json" with { type: "json" };
import pitDocument from "@ai-scouting/scouting/examples/pit.json" with { type: "json" };
import { db } from "./db.ts";
import { parseEventConfig } from "./event-config.ts";
import { stated } from "./extraction-fixture.ts";
import { cleanupPublished } from "./published-test-cleanup.ts";
import { changeEvent } from "./repositories/events.ts";
import { claimExtraction, finishExtraction } from "./repositories/extraction.ts";
import { saveIncomingNote } from "./repositories/intake.ts";
import { enrollMember } from "./repositories/members.ts";
import { scoutingReads } from "./repositories/scouting-data.ts";
import { withTenant } from "./repositories/tenant.ts";

// End-to-end contract extraction (#48): kind selection, pinned publications, linked replies,
// conditional rules, unknown/zero/false, and consumer-visible applicability.
let seq = 48000;
const next = () => String(++seq);
after(() => db.destroy());

const documents = { match: matchDocument, pit: pitDocument, general: generalDocument };
const publication = (kind: ObservationKind, version: string) => ({
  ...readContract(documents[kind], kind),
  version,
});

async function fixture(run: (org: string, event: string) => Promise<void>) {
  const org = randomUUID();
  try {
    await enrollMember({
      organizationId: org,
      organizationName: "Contract extraction",
      frcTeamNumber: 1241,
      memberName: "Admin",
      role: "admin",
      channel: "telegram",
      externalUserId: "1",
    });
    const created = await changeEvent(org, "1", next(), {
      kind: "activate-frc",
      config: parseEventConfig({
        name: "Contracts",
        season: 2026,
        type: "offseason",
        startDate: "2026-11-01",
        endDate: "2026-11-02",
        timezone: "America/Toronto",
        source: "frc_events",
        frcEventCode: "GH48",
        tbaEventKey: "2026gh48",
      }),
    });
    assert.ok(created.eventId);
    const event = created.eventId;
    assert.equal(
      (await changeEvent(org, "1", next(), { kind: "validation", eventId: event, mode: "off" }))
        .status,
      "ok",
    );
    await run(org, event);
  } finally {
    await withTenant(org, async (tx) => {
      await cleanupPublished(tx, org);
      for (const table of [
        "outbound_delivery",
        "raw_entry",
        "intake_rejection",
        "event_command",
        "organization_event_setting",
        "event_team",
        "event",
        "channel_identity",
        "member",
      ] as const)
        await tx.deleteFrom(table).where("organization_id", "=", org).execute();
      await tx.deleteFrom("organization").where("id", "=", org).execute();
    });
  }
}

const publish = (org: string, kind: ObservationKind, version: string) =>
  withTenant(org, (tx) =>
    tx
      .insertInto("published_specification")
      .values({
        organization_id: org,
        season: 2026,
        kind,
        version,
        document: JSON.stringify(publication(kind, version)),
      })
      .execute(),
  );
const assign = (org: string, event: string, kind: ObservationKind, version: string) =>
  withTenant(org, async (tx) => {
    if (kind === "match")
      await tx
        .updateTable("event")
        .set({ specification_version: version })
        .where("organization_id", "=", org)
        .where("id", "=", event)
        .execute();
    else
      await tx
        .insertInto("event_specification_assignment")
        .values({ organization_id: org, event_id: event, kind, season: 2026, version })
        .execute();
  });
const note = async (org: string, text: string, kind?: ObservationKind, reply?: string) => {
  const saved = await saveIncomingNote({
    organizationId: org,
    channel: "telegram",
    externalUserId: "1",
    externalUpdateId: next(),
    text,
    kind,
    replyToMessageId: reply,
  });
  if (typeof saved !== "object") throw Error(`not saved: ${saved}`);
  return saved;
};
const finish = async (org: string, ...turns: Record<string, unknown>[]) => {
  const claim = await claimExtraction(org);
  assert.ok(claim);
  const question = next();
  const saved = await finishExtraction(
    org,
    claim.id,
    claim.lease,
    stated(turns[0] ?? {}, claim.contract.version, ...turns.slice(1)),
    question,
  );
  assert.ok(saved.result);
  return { claim, question, result: saved.result };
};
const revision = (org: string, session: string) =>
  withTenant(org, (tx) =>
    tx
      .selectFrom("observation_revision")
      .selectAll()
      .where("organization_id", "=", org)
      .where("session_id", "=", session)
      .executeTakeFirst(),
  );

test("match contracts run rules after each linked reply; hidden answers leave current results", async () =>
  fixture(async (org, event) => {
    await publish(org, "match", "v1");
    await assign(org, event, "match", "v1");
    const session = await note(org, "Q1 1241 played, 0 auto, climbed, no defence, fast cycles");
    assert.equal(session.kind, "match");
    const first = {
      match: "Q1",
      team_number: 1241,
      robot_status: "played",
      auto_pieces: 0,
      climbed: true,
      played_defence: false,
      cycle_speed: "fast",
    };
    const initial = await finish(org, first);
    assert.equal(initial.claim.contract.version, "v1");
    assert.equal(initial.claim.contract.kind, "match");
    assert.equal(initial.result.status, "needs_review");
    assert.equal(
      initial.result.question,
      "Your note is missing some information. Which level did the robot climb to?",
    );
    // Zero and explicit false are answers, not missing values.
    assert.equal(initial.result.values.auto_pieces, 0);
    assert.equal(initial.result.values.played_defence, false);

    // A linked reply carries the question it answered. An unlisted option is invalid.
    await note(org, "roof", undefined, initial.question);
    const roof = await finish(org, first, { climb_level: "roof" });
    assert.equal(roof.claim.messages.length, 2);
    assert.match(roof.claim.messages[1]?.asked ?? "", /Which level/);
    assert.equal(roof.result.fields.climb_level?.state, "invalid");
    assert.match(roof.result.question ?? "", /Climb level \(Not one of the options\)/);

    // "It did not climb" hides the level: the observation completes without it.
    await note(org, "actually it did not climb", undefined, roof.question);
    const done = await finish(org, first, { climb_level: "roof" }, { climbed: false });
    assert.equal(done.result.status, "complete");
    const saved = await revision(org, session.sessionId);
    assert.ok(saved);
    assert.equal(saved.kind, "match");
    assert.equal(saved.specification_version, "v1");
    assert.equal(saved.season, 2026);
    const values = saved.values as Record<string, unknown>;
    assert.equal(values.climbed, false);
    assert.ok(!Object.hasOwn(values, "climb_level"));
    const applicability = saved.applicability as {
      fields: Record<string, { state: string }>;
      inactive: Record<string, unknown>;
    };
    assert.equal(applicability.fields.climb_level?.state, "inactive");
    assert.equal(applicability.inactive.climb_level, "roof");
    assert.equal(applicability.fields.defence_notes?.state, "unanswered");

    // Consumers see state, not statements, history, problems or raw text.
    const page = await scoutingReads.observations(
      { organizationId: org, eventId: event },
      { limit: 10, after: null },
    );
    const exported = page?.data[0];
    assert.ok(exported);
    assert.equal(exported.kind, "match");
    assert.equal(exported.values.climb_level, null);
    assert.equal(exported.values.auto_pieces, 0);
    assert.equal(exported.fields.climb_level?.state, "inactive");
    assert.equal(exported.fields.defence_notes?.requirement, "optional");
    assert.equal(exported.completeness.status, "complete");
    assert.ok(!JSON.stringify(exported).includes("roof"));
    assert.ok(!JSON.stringify(exported).includes("did not climb"));
  }));

test("open sessions keep their pinned version; a new assignment affects new sessions only", async () =>
  fixture(async (org, event) => {
    await publish(org, "match", "v1");
    await publish(org, "match", "v2");
    await assign(org, event, "match", "v1");
    const open = await note(org, "Q2 1241");
    const asked = await finish(org, { match: "Q2", team_number: 1241 });
    assert.equal(asked.result.status, "needs_review");
    await assign(org, event, "match", "v2");
    await note(org, "it played", undefined, asked.question);
    const resumed = await claimExtraction(org);
    assert.ok(resumed);
    assert.equal(resumed.id, open.sessionId);
    assert.equal(resumed.contract.version, "v1");
    // A response for another version is refused rather than applied to the pinned session.
    await assert.rejects(
      finishExtraction(org, resumed.id, resumed.lease, stated({}, "v2"), null),
      /Specification mismatch/,
    );
    const fresh = await note(org, "Q3 1242");
    const session = await withTenant(org, (tx) =>
      tx
        .selectFrom("scouting_session")
        .select(["kind", "specification_season", "specification_version"])
        .where("organization_id", "=", org)
        .where("id", "=", fresh.sessionId)
        .executeTakeFirstOrThrow(),
    );
    assert.deepEqual(session, {
      kind: "match",
      specification_season: 2026,
      specification_version: "v2",
    });
  }));

test("pit and general notes need an explicit assignment and no match", async () =>
  fixture(async (org, event) => {
    const reject = (kind: ObservationKind) =>
      saveIncomingNote({
        organizationId: org,
        channel: "telegram",
        externalUserId: "1",
        externalUpdateId: next(),
        text: `/${kind} 1241 swerve`,
        kind,
      });
    assert.equal(await reject("pit"), "kind_unassigned");
    await publish(org, "pit", "v1");
    await publish(org, "general", "v1");
    await assign(org, event, "pit", "v1");
    assert.equal(await reject("general"), "kind_unassigned");
    await assign(org, event, "general", "v1");

    const pit = await note(org, "/pit 1241 swerve, cannot climb", "pit");
    assert.equal(pit.kind, "pit");
    const pitAsk = await finish(org, { drivetrain: "swerve" });
    assert.equal(pitAsk.claim.contract.kind, "pit");
    // The command word is transport, not scouting content.
    assert.equal(pitAsk.claim.messages[0]?.text, "1241 swerve, cannot climb");
    assert.match(pitAsk.result.question ?? "", /^I need the team number for this pit note\./);
    await note(org, "1241, it cannot climb", undefined, pitAsk.question);
    const pitDone = await finish(
      org,
      { drivetrain: "swerve" },
      { team_number: 1241, can_climb: false },
    );
    assert.equal(pitDone.result.status, "complete");
    const pitRevision = await revision(org, pit.sessionId);
    assert.equal(pitRevision?.kind, "pit");
    assert.equal(pitRevision?.match_id, null);
    assert.equal(pitRevision?.team_number, 1241);
    assert.equal(pitRevision?.outcome, "unchecked");
    assert.equal((pitRevision?.validation as { status?: string } | undefined)?.status, "off");

    // General: a field note needs no team. A team topic makes the team required.
    const general = await note(org, "/general field lights flickered", "general");
    const field = await finish(org, { topic: "field", notes: "Field lights flickered" });
    assert.equal(field.result.status, "complete");
    const generalRevision = await revision(org, general.sessionId);
    assert.equal(generalRevision?.kind, "general");
    assert.equal(generalRevision?.team_number, null);
    await note(org, "/general a team was loud", "general");
    const team = await finish(org, { topic: "team", notes: "Loud pit" });
    assert.equal(team.result.status, "needs_review");
    assert.deepEqual(team.result.missing, ["team_number"]);

    const page = await scoutingReads.observations(
      { organizationId: org, eventId: event },
      { limit: 10, after: null },
    );
    const kinds = page?.data.map((o) => o.kind).sort();
    assert.deepEqual(kinds, ["general", "general", "pit"]);
    const pitSpec = await scoutingReads.specification(org, event, "v1", "pit");
    assert.equal(pitSpec?.kind, "pit");
    assert.ok(pitSpec?.questions.some((q) => q.key === "drivetrain"));
    assert.ok(!JSON.stringify(pitSpec).includes("guidance"));
  }));

test("pit notes for a team not at the event warn and save only on request", async () =>
  fixture(async (org, event) => {
    await publish(org, "pit", "v1");
    await assign(org, event, "pit", "v1");
    const pitNote = async (team: number) => {
      const saved = await note(org, `/pit ${team} swerve, cannot climb`, "pit");
      const turn = { team_number: team, drivetrain: "swerve", can_climb: false };
      return { saved, turn, finished: await finish(org, turn) };
    };
    // Without a saved roster the check cannot run, so the note is not held back.
    for (const mode of ["warn", "strict"] as const) {
      assert.equal(
        (await changeEvent(org, "1", next(), { kind: "validation", eventId: event, mode })).status,
        "ok",
      );
      const unchecked = await pitNote(9998);
      assert.equal(unchecked.finished.result.status, "complete");
    }
    await withTenant(org, (tx) =>
      tx
        .insertInto("event_team")
        .values(
          [1241, 1242].map((team_number) => ({
            organization_id: org,
            event_id: event,
            team_number,
          })),
        )
        .execute(),
    );
    // Strict mode still lets the scout keep a pit note.
    const unknown = await pitNote(9999);
    assert.equal(unknown.finished.result.status, "needs_review");
    assert.match(
      unknown.finished.result.question ?? "",
      /Team 9999 is not on the team list for this event\. Reply with the correct team number, or “save unverified”/,
    );
    assert.equal(await revision(org, unknown.saved.sessionId), undefined);
    await note(org, "save unverified", undefined, unknown.finished.question);
    const kept = await finish(org, unknown.turn, {});
    assert.equal(kept.result.status, "complete");
    const keptRevision = await revision(org, unknown.saved.sessionId);
    assert.equal(keptRevision?.team_number, 9999);
    assert.equal(keptRevision?.outcome, "warning_acknowledged");
    // A corrected team number passes the check.
    const typo = await pitNote(1214);
    assert.equal(typo.finished.result.status, "needs_review");
    await note(org, "sorry, 1241", undefined, typo.finished.question);
    const fixed = await finish(org, typo.turn, { team_number: 1241 });
    assert.equal(fixed.result.status, "complete");
    assert.equal((await revision(org, typo.saved.sessionId))?.outcome, "validated");
    // Off mode skips the check.
    assert.equal(
      (await changeEvent(org, "1", next(), { kind: "validation", eventId: event, mode: "off" }))
        .status,
      "ok",
    );
    const off = await pitNote(9997);
    assert.equal(off.finished.result.status, "complete");
    assert.equal((await revision(org, off.saved.sessionId))?.outcome, "unchecked");
  }));

test("sessions and publications stay inside their organization", async () =>
  fixture(async (org, event) =>
    fixture(async (other) => {
      await publish(org, "pit", "v1");
      await assign(org, event, "pit", "v1");
      // Another team cannot read this team's publication or assignment.
      assert.equal(await scoutingReads.specification(other, event, "v1", "pit"), null);
      assert.equal(
        await saveIncomingNote({
          organizationId: other,
          channel: "telegram",
          externalUserId: "1",
          externalUpdateId: next(),
          text: "/pit 1241",
          kind: "pit",
        }),
        "kind_unassigned",
      );
      assert.equal(await claimExtraction(other), null);
    }),
  ));
