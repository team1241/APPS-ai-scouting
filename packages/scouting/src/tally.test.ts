import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Contract,
  checkAnswer,
  evaluateAnswers,
  finalizeTurns,
  modelContract,
  modelOutputSchema,
  type Question,
  turnsFromModelOutput,
  validateContract,
} from "./index.ts";

const scored: Question = {
  key: "coral_scored",
  label: "Coral scored",
  prompt: "How many coral did the robot score on each level?",
  guidance: "Coral placed on the reef during teleop.",
  required: true,
  answer: {
    type: "tally",
    options: [
      { code: "l1", label: "Level 1" },
      { code: "l2", label: "Level 2" },
      { code: "l4", label: "Level 4" },
    ],
    max: 12,
    maxTotal: 20,
  },
};

const contract = (question: Question = scored): Contract => ({
  formatVersion: 2,
  kind: "general",
  version: "test",
  description: "",
  questions: [question],
});

const issues = (question: Question) => {
  const result = validateContract(contract(question), "general");
  return result.ok ? [] : result.issues.map((i) => i.code);
};

test("tally contracts validate options and limits", () => {
  assert.deepEqual(issues(scored), []);
  const answer = scored.answer as Extract<Question["answer"], { type: "tally" }>;
  assert.deepEqual(issues({ ...scored, answer: { ...answer, options: [] } }), [
    "invalid_structure",
  ]);
  assert.deepEqual(
    issues({
      ...scored,
      answer: { ...answer, options: [...answer.options, { code: "l1", label: "Again" }] },
    }),
    ["duplicate_option"],
  );
  assert.deepEqual(issues({ ...scored, answer: { ...answer, max: 30, maxTotal: 20 } }), [
    "invalid_constraint",
  ]);
  assert.deepEqual(issues({ ...scored, answer: { ...answer, max: 1.5 } }), ["invalid_structure"]);
});

test("rules cannot depend on a tally", () => {
  const dependent: Question = {
    key: "notes",
    label: "Notes",
    prompt: "Anything else?",
    guidance: "Free text.",
    required: false,
    answer: { type: "text" },
    rules: [{ effect: "show", when: { question: "coral_scored", operator: "gt", value: 1 } }],
  };
  const result = validateContract({ ...contract(), questions: [scored, dependent] }, "general");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.issues.some((i) => i.code === "unsupported_comparison"));
});

test("tally answers keep stated options only and are never coerced", () => {
  assert.deepEqual(checkAnswer(scored, { l1: 2, l4: 0 }), {
    status: "known",
    value: { l1: 2, l4: 0 },
  });
  // Unstated options stay unknown; an empty tally is unknown, not zero.
  assert.deepEqual(checkAnswer(scored, { l2: null }), { status: "unknown" });
  assert.deepEqual(checkAnswer(scored, {}), { status: "unknown" });
  assert.equal(checkAnswer(scored, { l3: 1 }).status, "invalid");
  assert.equal(checkAnswer(scored, { l1: 1.5 }).status, "invalid");
  assert.equal(checkAnswer(scored, { l1: -1 }).status, "invalid");
  assert.equal(checkAnswer(scored, { l1: 13 }).status, "invalid");
  assert.equal(checkAnswer(scored, { l1: 12, l2: 9 }).status, "invalid");
  assert.equal(checkAnswer(scored, [1, 2]).status, "invalid");
  assert.equal(checkAnswer(scored, 3).status, "invalid");
});

test("a required tally is complete once one option is stated", () => {
  assert.equal(evaluateAnswers(contract(), {}).status, "incomplete");
  const answered = evaluateAnswers(contract(), { coral_scored: { l4: 3 } });
  assert.equal(answered.status, "complete");
  assert.deepEqual(answered.current.coral_scored, { l4: 3 });
});

test("later messages merge counts by option", () => {
  const result = finalizeTurns(contract(), [
    { coral_scored: { l1: 2, l4: 3 } },
    { coral_scored: { l2: 1 } },
    { coral_scored: { l4: 4, l1: null } },
  ]);
  assert.deepEqual(result.values.coral_scored, { l2: 1, l4: 4 });
  assert.equal(result.status, "complete");
  // History keeps each message's own statement.
  assert.deepEqual(
    result.history.coral_scored?.map((h) => h.value),
    [{ l1: 2, l4: 3 }, { l2: 1 }, { l4: 4, l1: null }],
  );
  // A null tally withdraws every option; later counts start again.
  const withdrawn = finalizeTurns(contract(), [
    { coral_scored: { l1: 2 } },
    { coral_scored: null },
    { coral_scored: { l2: 1 } },
  ]);
  assert.deepEqual(withdrawn.values.coral_scored, { l2: 1 });
});

test("the model reports one answer per tally option", () => {
  const schema = modelOutputSchema(contract(), 2);
  const output = schema.parse({
    turns: [
      {
        answers: [
          { question: "coral_scored", option: "l1", value: 2 },
          { question: "coral_scored", option: "l4", value: 3 },
          { question: "coral_scored", option: "l4", value: 4 },
        ],
      },
      { answers: [{ question: "coral_scored", option: "l1", value: null }] },
    ],
  });
  // A later answer for the same option replaces the earlier one; null withdraws one option.
  assert.deepEqual(turnsFromModelOutput(contract(), output), [
    { coral_scored: { l1: 2, l4: 4 } },
    { coral_scored: { l1: null } },
  ]);
  // Without an option, null withdraws every count and anything else is checked as invalid.
  const whole = schema.parse({
    turns: [
      { answers: [{ question: "coral_scored", value: null }] },
      { answers: [{ question: "coral_scored", value: 5 }] },
    ],
  });
  const turns = turnsFromModelOutput(contract(), whole);
  assert.deepEqual(turns, [{ coral_scored: null }, { coral_scored: 5 }]);
  assert.equal(checkAnswer(scored, turns[1]?.coral_scored).status, "invalid");
  // An unlisted option code is kept, so the tally is reported as invalid, not dropped.
  const unlisted = turnsFromModelOutput(
    contract(),
    schema.parse({
      turns: [{ answers: [{ question: "coral_scored", option: "l9", value: 1 }] }, { answers: [] }],
    }),
  );
  assert.equal(checkAnswer(scored, unlisted[0]?.coral_scored).status, "invalid");
  const answer = modelContract(contract()).questions[0]?.answer ?? "";
  assert.match(answer, /l2 \(Level 2\)/);
  assert.match(answer, /at most 12 for one option, at most 20 in total/);
  assert.match(answer, /one answer per option/);
});
