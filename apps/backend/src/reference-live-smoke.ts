// Explicit development-only smoke; does not run in CI or production startup.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "./db.ts";
import { lookupFrcEvent } from "./frc-events.ts";
import { frcProvider, tbaProvider } from "./reference-provider.ts";
import { changeEvent } from "./repositories/events.ts";
import { enrollMember } from "./repositories/members.ts";
import { linkTbaEvent, readReference, syncReference } from "./repositories/reference.ts";
import { withTenant } from "./repositories/tenant.ts";

if (process.env.REFERENCE_LIVE_SMOKE !== "true")
  throw new Error("Set REFERENCE_LIVE_SMOKE=true with a disposable development DATABASE_URL");
const org = randomUUID();
const code = process.env.REFERENCE_SMOKE_EVENT ?? "ONOSH";
try {
  await enrollMember({
    organizationId: org,
    organizationName: "Reference smoke",
    frcTeamNumber: 1241,
    memberName: "Smoke",
    role: "admin",
    channel: "telegram",
    externalUserId: "smoke",
  });
  const config = await lookupFrcEvent(2026, code);
  const event = await changeEvent(org, "smoke", "smoke", { kind: "import-frc", config });
  assert.ok(event.eventId);
  if (process.env.REFERENCE_SMOKE_TBA_KEY)
    assert.equal(
      event.tbaEventKey,
      process.env.REFERENCE_SMOKE_TBA_KEY,
      "TBA key should be discovered on creation",
    );
  const first = await syncReference(org, "smoke", event.eventId, frcProvider());
  assert.equal(first.status, "ok");
  const before = await readReference(org, "smoke", event.eventId);
  const second = await syncReference(org, "smoke", event.eventId, frcProvider());
  assert.equal(second.status, "ok");
  const after = await readReference(org, "smoke", event.eventId);
  assert.deepEqual(
    after.matches.map((m) => m.id),
    before.matches.map((m) => m.id),
  );
  assert.ok(after.teams.length > 0);
  if (process.env.REFERENCE_SMOKE_TBA_KEY) {
    await linkTbaEvent(org, "smoke", event.eventId, process.env.REFERENCE_SMOKE_TBA_KEY);
    const supplemental = await syncReference(org, "smoke", event.eventId, tbaProvider());
    assert.equal(supplemental.status, "ok");
    const combined = await readReference(org, "smoke", event.eventId);
    assert.equal(combined.matches.length, after.matches.length);
    assert.deepEqual(
      combined.matches.map((m) => m.id),
      after.matches.map((m) => m.id),
    );
    console.log({ tbaSupplementStable: true });
  }
  console.log({
    source: "frc_events",
    event: `2026 ${code}`,
    teams: after.teams.length,
    matches: after.matches.length,
    repeatedImportStable: true,
  });
} finally {
  await withTenant(org, async (tx) => {
    await tx.deleteFrom("event_command").where("organization_id", "=", org).execute();
    await tx.deleteFrom("event").where("organization_id", "=", org).execute();
    await tx.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
    await tx.deleteFrom("member").where("organization_id", "=", org).execute();
    await tx.deleteFrom("organization").where("id", "=", org).execute();
  });
  await db.destroy();
}
