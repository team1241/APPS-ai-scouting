import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEventConfig } from "./event-config.ts";

const base = {
  name: "Offseason practice",
  season: 2026,
  type: "offseason",
  startDate: "2026-10-31",
  endDate: "2026-11-01",
  timezone: "America/Toronto",
};
test("event configuration validates dates, timezones, provider identifiers and supported specifications", () => {
  const event = parseEventConfig(base);
  assert.equal(event.validationMode, "warn");
  assert.equal(event.specificationVersion, "starter-match-v1");
  for (const patch of [
    { timezone: "Mars/Base" },
    { startDate: "2026-02-30" },
    { endDate: "2026-01-01" },
    { season: 2026.5 },
    { specificationVersion: "2027-unpublished" },
    { source: "frc_events" },
    { attending: "yes" },
    { unexpected: true },
  ]) {
    assert.throws(() => parseEventConfig({ ...base, ...patch }));
  }
  assert.equal(
    parseEventConfig({ ...base, source: "frc_events", frcEventCode: "ONTEST" }).frcEventCode,
    "ONTEST",
  );
  assert.equal(
    parseEventConfig({ ...base, source: "tba", tbaEventKey: "2026test" }).tbaEventKey,
    "2026test",
  );
});
