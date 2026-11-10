import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { requirements } from "@ai-scouting/scouting";
import { sql } from "kysely";
import { dataApiRoutes } from "./data-api.ts";
import { db } from "./db.ts";
import { stated } from "./extraction-fixture.ts";
import { finishExtraction } from "./repositories/extraction.ts";
import { enrollMember } from "./repositories/members.ts";
import { scoutingReads } from "./repositories/scouting-data.ts";

after(() => db.destroy());

test("current scouting reads isolate tenants, publish drafts, retain logical IDs, and paginate", async () => {
  const org = randomUUID();
  const other = randomUUID();
  const member = await enrollMember({
    organizationId: org,
    organizationName: "Export fixture",
    frcTeamNumber: 1241,
    memberName: "PRIVATE SCOUT",
    role: "admin",
    channel: "fixture",
    externalUserId: randomUUID(),
  });
  const outsider = await enrollMember({
    organizationId: other,
    organizationName: "Other fixture",
    frcTeamNumber: 1,
    memberName: "Other",
    role: "admin",
    channel: "fixture",
    externalUserId: randomUUID(),
  });
  const event = async (organization_id: string) => {
    const row = await db
      .insertInto("event")
      .values({
        organization_id,
        name: "Practice",
        season: 2026,
        type: "practice",
        start_date: "2026-11-09",
        end_date: "2026-11-10",
        timezone: "America/Toronto",
        specification_version: requirements.version,
        frc_event_code: organization_id === org ? "ONOSH" : null,
        tba_event_key: "2026onosh",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("published_specification")
      .values({
        organization_id,
        season: 2026,
        kind: "match",
        version: requirements.version,
        document: JSON.stringify(requirements),
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    return row.id;
  };
  const eventId = await event(org);
  const foreignEvent = await event(other);
  let tick = 0;
  const extraction = (climbed: boolean | null) =>
    JSON.stringify({
      specificationVersion: requirements.version,
      status: climbed === null ? "needs_review" : "complete",
      values: {
        match: "Q1",
        team_number: 1241,
        climbed,
        notes: "Derived note",
        private_identity: "PRIVATE",
      },
      missing: climbed === null ? ["climbed"] : [],
      question: "PRIVATE",
    });
  const session = async (
    options: {
      org?: string;
      event?: string;
      member?: string;
      pending?: boolean;
      unknownTeam?: boolean;
      replaces?: string;
    } = {},
  ) => {
    const id = randomUUID();
    const organization_id = options.org ?? org;
    const member_id = options.member ?? member;
    await db
      .insertInto("raw_entry")
      .values({
        id,
        organization_id,
        member_id,
        channel: "fixture",
        external_update_id: id,
        text: "PRIVATE RAW",
        extraction_result: options.pending ? null : extraction(null),
        extracted_at: options.pending ? null : new Date(Date.UTC(2026, 10, 9, 0, 0, ++tick)),
      })
      .execute();
    await db
      .insertInto("scouting_session")
      .values({
        id,
        organization_id,
        member_id,
        event_id: options.event ?? eventId,
        specification_version: requirements.version,
        team_number: options.unknownTeam ? null : 1241,
        match_label: "qm:1",
        replaces_revision_id: options.replaces ?? null,
        validation_result: JSON.stringify({
          mode: "warn",
          status: "missing_schedule",
          conflictSessionId: "PRIVATE",
        }),
      })
      .execute();
    return id;
  };
  const root = await session();
  const independent = await session();
  const pending = await session({ pending: true });
  await session({ unknownTeam: true });
  await session({ org: other, member: outsider, event: foreignEvent });
  const scope = { organizationId: org, eventId };
  const page = { limit: 100, after: null };
  const initial = await scoutingReads.observations(scope, page);
  assert.equal(initial?.data.length, 2);
  assert.ok(
    initial?.data.every(
      (row) =>
        row.event.id === eventId &&
        row.event.code === "ONOSH" &&
        row.event.label === "Practice" &&
        row.match.label === "Q1" &&
        row.values.match === "Q1",
    ),
  );
  assert.equal(
    (await scoutingReads.events({ organizationId: org, teamNumber: 1241 }, page)).data[0]
      ?.eventCode,
    "ONOSH",
  );
  assert.equal(
    (await scoutingReads.observations({ organizationId: other, eventId: foreignEvent }, page))
      ?.data[0]?.event.code,
    "2026onosh",
  );
  assert.equal(initial?.data[0]?.completeness.status, "incomplete");
  assert.equal(initial?.data[0]?.match.resolved, false);
  assert.ok(!JSON.stringify(initial).includes("PRIVATE"));
  assert.equal(await scoutingReads.observations({ ...scope, eventId: foreignEvent }, page), null);
  assert.equal(
    (await scoutingReads.events({ organizationId: org, teamNumber: 1241 }, page)).data.length,
    1,
  );
  assert.equal(
    (await scoutingReads.events({ organizationId: other, teamNumber: 9999 }, page)).data.length,
    0,
  );
  assert.equal(await scoutingReads.specification(org, foreignEvent, requirements.version), null);
  assert.equal(
    (await scoutingReads.specification(org, eventId, requirements.version))?.fields?.length,
    requirements.fields.length,
  );

  // Follow-up modifies the same exported record and preserves explicit false.
  await db
    .updateTable("raw_entry")
    .set({ extraction_result: extraction(false), extracted_at: new Date("2026-11-10T00:00:00Z") })
    .where("id", "=", root)
    .execute();
  const followed = await scoutingReads.observations(scope, page);
  assert.deepEqual(
    followed?.data.map((r) => r.id),
    initial?.data.map((r) => r.id),
  );
  assert.ok(followed?.data.some((r) => r.values.climbed === false));
  const rootPublicId = followed?.data.find((r) => r.values.climbed === false)?.id;
  const revision = await db
    .insertInto("observation_revision")
    .values({
      organization_id: org,
      session_id: root,
      member_id: member,
      event_id: eventId,
      season: 2026,
      team_number: 1241,
      specification_version: requirements.version,
      values: JSON.stringify({}),
      validation: JSON.stringify({}),
      outcome: "unchecked",
      provenance: JSON.stringify({ private: "PRIVATE" }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const correction = await session({ replaces: revision.id });
  await db
    .updateTable("raw_entry")
    .set({ extracted_at: new Date("2026-11-11T00:00:00Z") })
    .where("id", "=", correction)
    .execute();
  const corrected = await scoutingReads.observations(scope, page);
  assert.equal(corrected?.data.length, 2);
  assert.equal(corrected?.data.find((r) => r.id === rootPublicId)?.values.climbed, null);
  assert.ok(corrected?.data.every((r) => r.completeness.status === "incomplete"));
  // Correcting the team removes the old team's record; unresolved team is absent from bulk too.
  await db
    .updateTable("scouting_session")
    .set({ team_number: 9999 })
    .where("id", "=", correction)
    .execute();
  assert.equal(
    (await scoutingReads.observations({ ...scope, teamNumber: 1241 }, page))?.data.length,
    1,
  );
  assert.equal(
    (await scoutingReads.observations({ ...scope, teamNumber: 9999 }, page))?.data[0]?.id,
    rootPublicId,
  );

  // A completed correction wins over unfinished sibling drafts targeting its predecessor.
  const winningRevision = await db
    .insertInto("observation_revision")
    .values({
      organization_id: org,
      session_id: correction,
      member_id: member,
      event_id: eventId,
      season: 2026,
      team_number: 9999,
      specification_version: requirements.version,
      values: JSON.stringify({}),
      validation: JSON.stringify({}),
      outcome: "unchecked",
      provenance: JSON.stringify({}),
      replaces_revision_id: revision.id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const staleSibling = await session({ replaces: revision.id });
  await db
    .updateTable("raw_entry")
    .set({ extracted_at: new Date("2026-11-12T00:00:00Z") })
    .where("id", "=", staleSibling)
    .execute();
  assert.equal(
    (await scoutingReads.observations({ ...scope, teamNumber: 9999 }, page))?.data[0]?.id,
    rootPublicId,
  );
  // Another generation still has the original logical ID, without exposing the chain.
  const nextCorrection = await session({ replaces: winningRevision.id });
  await db
    .updateTable("raw_entry")
    .set({ extracted_at: new Date("2026-11-13T00:00:00Z") })
    .where("id", "=", nextCorrection)
    .execute();
  assert.equal((await scoutingReads.observations(scope, page))?.data.length, 2);
  assert.ok(
    (await scoutingReads.observations(scope, page))?.data.some((row) => row.id === rootPublicId),
  );

  const app = dataApiRoutes({
    verify: async () => ({ valid: true, keyId: "key", organizationId: org }),
    active: async () => true,
    organization: async () => undefined,
    scouting: scoutingReads,
  });
  const get = async (query: string) => {
    const response = await app.request(`/events/${eventId}/observations?${query}`, {
      headers: { authorization: "Bearer test" },
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ data: { id: string }[]; nextCursor: string | null }>;
  };
  const first = await get("limit=1");
  const second = await get(`limit=1&cursor=${first.nextCursor}`);
  assert.equal(second.nextCursor, null);
  assert.notEqual(first.data[0]?.id, second.data[0]?.id);
  assert.equal((await get("limit=100")).data.length, 2);

  // The actual extraction writer publishes incomplete results without finalization.
  await db
    .insertInto("channel_identity")
    .values({
      organization_id: org,
      member_id: member,
      channel: "telegram",
      external_id: randomUUID(),
    })
    .execute();
  const lease = new Date();
  await db
    .updateTable("raw_entry")
    .set({ status: "processing", processing_started_at: lease })
    .where("id", "=", pending)
    .execute();
  await finishExtraction(org, pending, lease, stated(JSON.parse(extraction(null)).values), null);
  const saved = await db
    .selectFrom("raw_entry")
    .select("extracted_at")
    .where("id", "=", pending)
    .executeTakeFirstOrThrow();
  assert.ok(saved.extracted_at instanceof Date);
  assert.equal((await scoutingReads.observations(scope, page))?.data.length, 3);

  // Re-run reads with a non-owner role to exercise actual row-level policies.
  await sql`CREATE ROLE gh22_reader NOLOGIN`.execute(db);
  try {
    await sql`GRANT USAGE ON SCHEMA public TO gh22_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO gh22_reader`.execute(
      db,
    );
    const { pool } = await import("./db.ts");
    const client = await pool.connect();
    try {
      await client.query("SET ROLE gh22_reader");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.organization_id', $1, true)", [org]);
      const hidden = await client.query(
        "SELECT id FROM scouting_session WHERE organization_id=$1",
        [other],
      );
      assert.equal(hidden.rows.length, 0);
      await client.query("ROLLBACK");
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  } finally {
    await sql`DROP OWNED BY gh22_reader; DROP ROLE gh22_reader`.execute(db);
  }
  assert.ok(independent);
});
