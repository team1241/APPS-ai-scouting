import assert from "node:assert/strict";
import { test } from "node:test";
import generalDocument from "./examples/general.json" with { type: "json" };
import matchDocument from "./examples/match.json" with { type: "json" };
import pitDocument from "./examples/pit.json" with { type: "json" };
import {
  draftTestMessagesSchema,
  evaluateAnswers,
  finalizeTurns,
  finalizeWithEvaluation,
  LIMITS_DRAFT_TEST,
  readContract,
  sampleCases,
  statedValues,
} from "./index.ts";

const contracts = {
  match: readContract(matchDocument, "match"),
  pit: readContract(pitDocument, "pit"),
  general: readContract(generalDocument, "general"),
};

const expected: Record<string, { status: string; missing?: string[]; inactive?: string[] }> = {
  "match-complete": { status: "complete" },
  "match-climb-level": { status: "complete" },
  "match-correction": { status: "complete", inactive: ["climb_level"] },
  "match-incomplete": { status: "needs_review", missing: ["match", "team_number", "robot_status"] },
  "pit-climb-levels": { status: "complete" },
  "pit-explicit-false": { status: "complete" },
  "pit-incomplete": { status: "needs_review", missing: ["can_climb"] },
  "general-field": { status: "complete" },
  "general-team": { status: "complete" },
};

test("every sample case is a valid synthetic exchange for its worked example", () => {
  for (const sample of sampleCases) {
    const contract = contracts[sample.kind];
    assert.equal(sample.messages.length, sample.turns.length, sample.id);
    assert.ok(draftTestMessagesSchema.safeParse(sample.messages).success, sample.id);
    const keys = new Set(contract.questions.map((q) => q.key));
    for (const turn of sample.turns)
      for (const key of Object.keys(turn)) assert.ok(keys.has(key), `${sample.id}: ${key}`);
    const result = finalizeTurns(contract, sample.turns);
    const want = expected[sample.id];
    assert.ok(want, sample.id);
    assert.equal(result.status, want.status, sample.id);
    if (want.missing) assert.deepEqual(result.missing, want.missing, sample.id);
    if (want.inactive) assert.deepEqual(Object.keys(result.inactive), want.inactive, sample.id);
  }
});

test("each kind has samples, including zero, explicit false and a correction", () => {
  for (const kind of ["match", "pit", "general"] as const)
    assert.ok(sampleCases.filter((s) => s.kind === kind).length >= 2, kind);
  const correction = sampleCases.find((s) => s.id === "match-correction");
  assert.equal(correction?.turns[1]?.auto_pieces, 0);
  assert.equal(correction?.turns[1]?.climbed, false);
});

test("preview and production agree: one answer set gives the same result either way", () => {
  for (const sample of sampleCases) {
    const contract = contracts[sample.kind];
    const merged = Object.assign({}, ...sample.turns);
    const { result, evaluation } = finalizeWithEvaluation(contract, [merged]);
    assert.deepEqual(result, finalizeTurns(contract, [merged]), sample.id);
    const direct = evaluateAnswers(contract, statedValues(contract, merged));
    assert.deepEqual(evaluation.questions, direct.questions, sample.id);
    assert.deepEqual(result.values, direct.current, sample.id);
    assert.equal(result.status === "complete", direct.status === "complete", sample.id);
  }
});

test("rule outcomes explain visibility and requirement", () => {
  const { evaluation } = finalizeWithEvaluation(contracts.match, [
    { match: "Q1", team_number: 1241, robot_status: "no_show" },
  ]);
  const auto = evaluation.questions.find((q) => q.key === "auto_pieces");
  assert.deepEqual(auto?.rules, [{ index: 0, effect: "hide", holds: true }]);
  assert.equal(auto?.visibility, "hidden");
  const level = evaluation.questions.find((q) => q.key === "climb_level");
  // climbed is hidden, so a condition on it is false, not unknown.
  assert.deepEqual(level?.rules, [{ index: 0, effect: "show", holds: false }]);
  const unknown = finalizeWithEvaluation(contracts.match, [{ match: "Q1", team_number: 1241 }]);
  const climbed = unknown.evaluation.questions.find((q) => q.key === "climbed");
  assert.equal(climbed?.rules[0]?.holds, null);
  assert.equal(climbed?.visibility, "unknown");
});

test("hidden answers are kept as inactive, never current", () => {
  const { result } = finalizeWithEvaluation(contracts.match, [
    { match: "Q1", team_number: 1241, robot_status: "no_show", auto_pieces: 5 },
  ]);
  assert.equal(result.values.auto_pieces, undefined);
  assert.deepEqual(result.inactive, { auto_pieces: 5 });
  assert.equal(result.fields.auto_pieces?.state, "inactive");
});

test("draft test input is bounded", () => {
  const note = { role: "note" as const, text: "Q1 1241" };
  assert.ok(draftTestMessagesSchema.safeParse([note]).success);
  assert.equal(draftTestMessagesSchema.safeParse([]).success, false);
  assert.equal(draftTestMessagesSchema.safeParse([{ role: "reply", text: "3" }]).success, false);
  assert.equal(draftTestMessagesSchema.safeParse([note, note]).success, false);
  assert.equal(
    draftTestMessagesSchema.safeParse([{ ...note, text: "x".repeat(LIMITS_DRAFT_TEST.text + 1) }])
      .success,
    false,
  );
  const reply = { role: "reply" as const, text: "y".repeat(LIMITS_DRAFT_TEST.text) };
  assert.equal(
    draftTestMessagesSchema.safeParse([note, reply, reply, reply, reply, reply, reply]).success,
    false,
  );
  assert.equal(draftTestMessagesSchema.safeParse([note, reply, reply, reply]).success, false);
});
