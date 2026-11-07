import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { db } from "./db.ts";
import { parseEventConfig } from "./event-config.ts";
import { normalizeFrcEvent } from "./frc-events.ts";
import {
  normalizeFrcSchedule,
  normalizeFrcTeams,
  normalizeTbaMatches,
  type ReferenceProvider,
} from "./reference-provider.ts";
import { changeEvent } from "./repositories/events.ts";
import { enrollMember } from "./repositories/members.ts";
import {
  linkTbaEvent,
  overrideReference,
  readReference,
  syncReference,
} from "./repositories/reference.ts";
import { withTenant } from "./repositories/tenant.ts";

after(() => db.destroy());
const fixture = async (name: string) =>
  JSON.parse(
    await readFile(new URL(`./fixtures/2026-onham1/${name}.json`, import.meta.url), "utf8"),
  );
test("imports serialize, retain stable IDs, overrides and prior data through rescheduling/partial/failure", async () => {
  const org = randomUUID();
  try {
    await enrollMember({
      organizationId: org,
      organizationName: "Reference tests",
      frcTeamNumber: 1241,
      memberName: "Admin",
      role: "admin",
      channel: "telegram",
      externalUserId: "1",
    });
    const created = await changeEvent(org, "1", "1", {
      kind: "import-frc",
      config: parseEventConfig({
        name: "STEMley",
        season: 2026,
        type: "offseason",
        source: "frc_events",
        frcEventCode: "ONHAM1",
        startDate: "2026-10-31",
        endDate: "2026-10-31",
        timezone: "America/Toronto",
      }),
    });
    assert.ok(created.eventId);
    const id = created.eventId;
    const snapshot = {
      teams: normalizeFrcTeams(await fixture("teams")).teams,
      matches: normalizeFrcSchedule(await fixture("qualification"), "Qualification"),
      complete: true,
    };
    const provider: ReferenceProvider = { source: "frc_events", load: async () => snapshot };
    await assert.rejects(() => syncReference(org, "unknown", id, provider));
    await Promise.all([
      syncReference(org, "1", id, provider),
      syncReference(org, "1", id, provider),
    ]);
    const first = await readReference(org, "1", id);
    assert.equal(first.teams.length, 6);
    assert.equal(first.matches.length, snapshot.matches.length);
    const match = first.matches.find((m) => m.key === "qm:1");
    assert.ok(match);
    await overrideReference(org, "1", id, "match", match.id, { scheduled: "manual" });
    assert.ok(snapshot.matches[0]);
    snapshot.matches[0].scheduled = "2026-10-31T09:00:00";
    await syncReference(org, "1", id, provider);
    const second = await readReference(org, "1", id);
    assert.equal(second.matches.find((m) => m.key === "qm:1")?.id, match.id);
    assert.equal(second.matches.find((m) => m.key === "qm:1")?.scheduled, "manual");
    snapshot.matches = snapshot.matches.slice(0, 1);
    snapshot.complete = false;
    await syncReference(org, "1", id, provider);
    assert.equal((await readReference(org, "1", id)).matches.length, first.matches.length);
    await syncReference(org, "1", id, {
      source: "frc_events",
      load: async () => {
        throw new Error("secret must never persist");
      },
    });
    const failed = await readReference(org, "1", id);
    assert.equal(failed.matches.length, first.matches.length);
    assert.equal(failed.sync[0]?.status, "failed");
    assert.equal(failed.sync[0]?.freshness, "stale");
    assert.ok(failed.sync[0]?.succeeded_at);
    assert.doesNotMatch(failed.sync[0]?.error ?? "", /secret/);
    assert.equal((await syncReference(org, "1", id, provider, 300000)).status, "skipped");
  } finally {
    await withTenant(org, async (tx) => {
      await tx.deleteFrom("event_command").where("organization_id", "=", org).execute();
      await tx.deleteFrom("event").where("organization_id", "=", org).execute();
      await tx.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
      await tx.deleteFrom("member").where("organization_id", "=", org).execute();
      await tx.deleteFrom("organization").where("id", "=", org).execute();
    });
  }
});

test("paired championship fixtures supplement stable IDs while parent/division match numbers stay separate", async () => {
  const org = randomUUID();
  const read = async (code: string, name: string) =>
    JSON.parse(
      await readFile(
        new URL(`./fixtures/2026-${code.toLowerCase()}/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  try {
    await enrollMember({
      organizationId: org,
      organizationName: "Championship tests",
      frcTeamNumber: 1241,
      memberName: "Admin",
      role: "admin",
      channel: "telegram",
      externalUserId: "1",
    });
    const firstMatchIds: string[] = [];
    for (const code of ["ONCMP", "ONCMP1"]) {
      const metadata = await read(code, "event");
      const tbaMetadata = await read(code, "tba-event");
      const created = await changeEvent(org, "1", code, {
        kind: "import-frc",
        config: normalizeFrcEvent(metadata, 2026, code),
      });
      assert.ok(created.eventId);
      const eventId = created.eventId;
      const primary: ReferenceProvider = {
        source: "frc_events",
        load: async () => ({
          teams: normalizeFrcTeams(await read(code, "teams")).teams,
          matches: [
            ...normalizeFrcSchedule(await read(code, "qualification"), "Qualification"),
            ...normalizeFrcSchedule(await read(code, "playoff"), "Playoff"),
          ],
          complete: true,
          eventFacts: metadata,
        }),
      };
      await syncReference(org, "1", eventId, primary);
      const before = await readReference(org, "1", eventId);
      const match = before.matches.find((m) => m.key === "first:playoff:1");
      assert.ok(match);
      firstMatchIds.push(match.id);
      await linkTbaEvent(org, "1", eventId, tbaMetadata.key);
      const supplement: ReferenceProvider = {
        source: "tba",
        load: async () => ({
          teams: [],
          matches: normalizeTbaMatches(await read(code, "tba-matches"), tbaMetadata.key),
          complete: true,
          eventFacts: tbaMetadata,
        }),
      };
      await syncReference(org, "1", eventId, supplement);
      const after = await readReference(org, "1", eventId);
      assert.deepEqual(
        after.matches.map((m) => m.id),
        before.matches.map((m) => m.id),
      );
      assert.equal(after.sync.length, 2);
      const stored = await withTenant(org, (tx) =>
        tx
          .selectFrom("event_match")
          .select("facts")
          .where("organization_id", "=", org)
          .where("id", "=", match.id)
          .executeTakeFirstOrThrow(),
      );
      assert.deepEqual(Object.keys(stored.facts as object).sort(), ["frc_events", "tba"]);
    }
    assert.notEqual(firstMatchIds[0], firstMatchIds[1]);
  } finally {
    await withTenant(org, async (tx) => {
      await tx.deleteFrom("event_command").where("organization_id", "=", org).execute();
      await tx.deleteFrom("event").where("organization_id", "=", org).execute();
      await tx.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
      await tx.deleteFrom("member").where("organization_id", "=", org).execute();
      await tx.deleteFrom("organization").where("id", "=", org).execute();
    });
  }
});
