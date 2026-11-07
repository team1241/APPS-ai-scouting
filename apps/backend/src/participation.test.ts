import assert from "node:assert/strict";
import { test } from "node:test";
import { type ScheduledMatch, scheduleState, validateParticipation } from "./participation.ts";

const participants = ["Red1", "Red2", "Red3", "Blue1", "Blue2", "Blue3"].map((station, i) => ({
  station,
  number: 1241 + i,
  surrogate: i === 5,
}));
const qualification: ScheduledMatch = {
  id: "q",
  identity: "qm:42",
  aliases: ["2026test_qm42", "qm42"],
  participants,
};
const playoff: ScheduledMatch = {
  id: "p",
  identity: "first:playoff:14",
  aliases: ["2026test_f1m1", "f1m1"],
  participants,
};
const check = (label: unknown, team: unknown, matches = [qualification, playoff]) =>
  validateParticipation("strict", "saved", matches, label, team);
test("all six alliance positions and surrogates are valid; invalid pairings do not resolve to a participant", () => {
  for (const p of participants) assert.equal(check("Q42", p.number).status, "valid");
  assert.equal(check("QM42", 1241).matchId, "q");
  assert.equal(check("qualification match 42", 1241).status, "valid");
  assert.equal(check("Q42", 9999).status, "invalid_pairing");
  assert.equal(check("Q43", 1241).status, "unknown_match");
  assert.equal(check(null, 1241).status, "missing_identity");
  assert.equal(check("Q42", null).status, "missing_identity");
});
test("playoffs require exact stage/set/match identity, with no round-number guessing", () => {
  for (const label of ["P14", "playoff 14", "first:playoff:14", "f1m1", "2026test_f1m1"])
    assert.equal(check(label, 1241).matchId, "p");
  for (const label of ["42", "final 1", "sf1"])
    assert.equal(check(label, 1241).status, "ambiguous_match");
  assert.equal(check("f2m1", 1241).status, "unknown_match");
  assert.equal(
    check("f1m1", 1241, [playoff, { ...playoff, id: "unmapped", identity: "tba:other" }]).status,
    "ambiguous_match",
  );
});
test("missing, stale and incomplete schedules fail closed; off bypasses validation", () => {
  for (const mode of ["warn", "strict"] as const) {
    assert.equal(validateParticipation(mode, "absent", [], "Q42", 1241).status, "missing_schedule");
    assert.equal(
      validateParticipation(mode, "stale", [qualification], "Q42", 1241).status,
      "stale_schedule",
    );
  }
  assert.equal(validateParticipation("off", "absent", [], null, null).status, "off");
  assert.equal(
    check("Q42", 1241, [{ ...qualification, participants: participants.slice(1) }]).status,
    "incomplete_participants",
  );
});
test("one-time acquired schedules do not expire with age; later failed/partial imports mark uncertainty", () => {
  const old = new Date("2020-01-01"),
    later = new Date("2020-01-02");
  assert.equal(scheduleState(old, 1, []), "saved");
  assert.equal(scheduleState(null, 1, []), "stale");
  assert.equal(scheduleState(old, 0, []), "absent");
  for (const status of ["failed", "partial"])
    assert.equal(
      scheduleState(old, 1, [{ status, attempted_at: later, succeeded_at: old }]),
      "stale",
    );
  assert.equal(
    scheduleState(old, 1, [{ status: "ok", attempted_at: later, succeeded_at: later }]),
    "saved",
  );
});
