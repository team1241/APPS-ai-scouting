// Disposable Postgres only. No provider calls, bot sends or paid model requests.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { db } from "./db.ts";
import { stated } from "./extraction-fixture.ts";
import { runExtractionPass } from "./extraction-worker.ts";
import { normalizeFrcEvent } from "./frc-events.ts";
import { drainOutbound } from "./outbound-worker.ts";
import { changeEvent } from "./repositories/events.ts";
import { saveIncomingNote } from "./repositories/intake.ts";
import { enrollMember } from "./repositories/members.ts";
import { operationSnapshot } from "./repositories/operations.ts";
import { claimDelivery } from "./repositories/outbound.ts";
import { withTenant } from "./repositories/tenant.ts";

const connection = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname) ||
  !connection.pathname.startsWith("/scouting_gh10_")
)
  throw Error("Simulation requires a local scouting_gh10_* disposable database");
const org = randomUUID(),
  started = performance.now(),
  realFetch = globalThis.fetch;
let modelCalls = 0,
  telegramCalls = 0;
try {
  for (const user of ["1", "2", "3", "4"])
    await enrollMember({
      organizationId: org,
      organizationName: "Synthetic reliability drill",
      frcTeamNumber: 1241,
      memberName: "Synthetic",
      role: user === "1" ? "admin" : "scout",
      channel: "telegram",
      externalUserId: user,
    });
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/2026-onosh/event.json", import.meta.url), "utf8"),
  );
  const configured = await changeEvent(
    org,
    "1",
    "simulated-event",
    { kind: "activate-frc", config: normalizeFrcEvent(fixture, 2026, "ONOSH") },
    async () => null,
  );
  assert.ok(configured.eventId);
  await withTenant(org, (tx) =>
    tx
      .updateTable("event")
      .set({ validation_mode: "off" })
      .where("organization_id", "=", org)
      .where("id", "=", configured.eventId as string)
      .execute(),
  );
  for (let i = 0; i < 120; i++) {
    const accepted = await saveIncomingNote({
      organizationId: org,
      externalUserId: String((i % 4) + 1),
      channel: "telegram",
      externalUpdateId: `synthetic-${i}`,
      text: "Q1 team 1241 did not climb",
    });
    assert.equal(typeof accepted, "object");
  }
  const queueBefore = await operationSnapshot(org, "1");
  globalThis.fetch = async () => {
    modelCalls++;
    return Response.json(stated({ match: "Q1", team_number: 1241, climbed: false, notes: null }));
  };
  while (await runExtractionPass(org, "http://localhost:4111")) {
    /* Deterministic fake model boundary. */
  }
  globalThis.fetch = realFetch;
  const first = await claimDelivery(org, new Date(Date.now() + 1000));
  assert.ok(first && !first.cancelled);
  // A crashed sender remains ambiguous on the next worker's recovery, with no resend.
  const failures = new Set<string>();
  const telegram: typeof fetch = async (_url, init) => {
    telegramCalls++;
    const body = JSON.parse(String(init?.body));
    if (body.chat_id === "4") return Response.json({ ok: false, error_code: 403 });
    if (body.chat_id === "2" && !failures.has(body.text)) {
      failures.add(body.text);
      return Response.json({ ok: false, error_code: 503 });
    }
    return Response.json({ ok: true, result: { message_id: telegramCalls } });
  };
  const future = new Date(Date.now() + 120000);
  await drainOutbound(org, "synthetic", telegram, future);
  for (let pass = 1; pass <= 4; pass++)
    await drainOutbound(org, "synthetic", telegram, new Date(future.getTime() + pass * 7200000));
  const snapshot = await operationSnapshot(org, "1", new Date(future.getTime() + 4 * 7200000));
  const counts = Object.fromEntries(snapshot.outbound.map((row) => [row.status, row.count]));
  assert.equal(counts.ambiguous, 1);
  assert.equal(counts.failed, 30);
  assert.equal(counts.sent, 89);
  assert.equal(modelCalls, 120);
  const revisions = await withTenant(org, (tx) =>
    tx.selectFrom("observation_revision").select("id").where("organization_id", "=", org).execute(),
  );
  assert.equal(revisions.length, 120);
  const report = {
    kind: "disposable simulated event",
    measuredAt: new Date().toISOString(),
    notes: 120,
    recipients: 4,
    finalizedRevisions: revisions.length,
    wallElapsedMs: Math.round(performance.now() - started),
    localMaxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    localCpuMs: Math.round((process.cpuUsage().user + process.cpuUsage().system) / 1000),
    databaseComputeCuHours: null,
    actualInputTokens: null,
    actualOutputTokens: null,
    platformBilledUsage: null,
    simulatedModelCalls: modelCalls,
    realModelCalls: 0,
    telegramRequestsMocked: telegramCalls,
    queueBefore,
    queueAfter: snapshot,
    outcomes: counts,
    limitations:
      "Local Postgres wall time; virtual +2min crash expiry/+2h per recovery pass clock. Delivery latencies include virtual time. No real tokens, CU-hours, hosting availability or vendor charges measured.",
  };
  const output = process.argv[2];
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  else console.log(JSON.stringify(report, null, 2));
} finally {
  globalThis.fetch = realFetch;
  await db.destroy();
}
