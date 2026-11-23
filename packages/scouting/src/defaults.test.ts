import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Contract,
  evaluateAnswers,
  finalizeTurns,
  modelContract,
  type Question,
  validateContract,
} from "./index.ts";

const question = (key: string, answer: Question["answer"], extra: Partial<Question> = {}) =>
  ({
    key,
    label: key,
    prompt: `${key}?`,
    guidance: "Only when stated.",
    required: false,
    answer,
    ...extra,
  }) as Question;

const status = question(
  "robot_status",
  {
    type: "single_choice",
    options: [
      { code: "played", label: "Played" },
      { code: "no_show", label: "No show" },
    ],
  },
  { required: true, default: "played" },
);
const defence = question(
  "played_defence",
  { type: "boolean" },
  {
    default: false,
    rules: [
      { effect: "hide", when: { question: "robot_status", operator: "equals", value: "no_show" } },
    ],
  },
);
const missed = question(
  "teleop_missed",
  {
    type: "tally",
    options: [
      { code: "l1", label: "Level 1" },
      { code: "l4", label: "Level 4" },
    ],
    max: 10,
  },
  { required: true, default: 0 },
);
const cycles = question(
  "cycles",
  { type: "number", format: "integer", min: 0, max: 30 },
  { default: 5 },
);

const contract = (questions: Question[]): Contract => ({
  formatVersion: 2,
  kind: "general",
  version: "test",
  description: "",
  questions,
});
const all = contract([status, defence, missed, cycles]);

const codes = (questions: Question[]) => {
  const result = validateContract(contract(questions), "general");
  return result.ok ? [] : result.issues.map((i) => i.code);
};

test("defaults must fit the answer type and are not allowed everywhere", () => {
  assert.deepEqual(codes(all.questions), []);
  assert.deepEqual(codes([status, { ...defence, default: "no" }]), ["invalid_default"]);
  assert.deepEqual(codes([{ ...status, default: "maybe" }]), ["invalid_default"]);
  assert.deepEqual(codes([{ ...cycles, default: 31 }]), ["invalid_default"]);
  assert.deepEqual(codes([{ ...cycles, default: 2.5 }]), ["invalid_default"]);
  assert.deepEqual(codes([{ ...missed, default: 11 }]), ["invalid_default"]);
  assert.deepEqual(codes([{ ...missed, default: -1 }]), ["invalid_default"]);
  assert.deepEqual(
    codes([
      {
        ...missed,
        answer: { ...missed.answer, max: 5, maxTotal: 5 } as Question["answer"],
        default: 3,
      },
    ]),
    ["invalid_default"],
  );
  assert.deepEqual(codes([question("notes", { type: "text" }, { default: "none" })]), [
    "invalid_default",
  ]);
  assert.deepEqual(
    codes([
      question(
        "tags",
        { type: "multiple_choice", options: [{ code: "a", label: "A" }] },
        { default: "a" },
      ),
    ]),
    ["invalid_default"],
  );
  assert.deepEqual(
    codes([
      question("team_number", { type: "number", format: "integer", min: 1 }, { default: 1241 }),
    ]),
    ["invalid_default"],
  );
});

test("an unstated question takes its default, and a required one is not asked", () => {
  const result = evaluateAnswers(all, {});
  assert.equal(result.status, "complete");
  assert.deepEqual(result.followUps, []);
  assert.deepEqual(result.current, {
    robot_status: "played",
    played_defence: false,
    teleop_missed: { l1: 0, l4: 0 },
    cycles: 5,
  });
  assert.ok(result.questions.every((q) => q.defaulted && q.state === "answered"));
});

test("a stated answer always wins over the default", () => {
  const result = evaluateAnswers(all, {
    robot_status: "played",
    played_defence: true,
    teleop_missed: { l1: 2, l4: 1 },
    cycles: 0,
  });
  assert.deepEqual(result.current, {
    robot_status: "played",
    played_defence: true,
    teleop_missed: { l1: 2, l4: 1 },
    cycles: 0,
  });
  assert.ok(result.questions.every((q) => !q.defaulted));
});

test("a tally default fills only the options the scout did not state", () => {
  const result = evaluateAnswers(all, { teleop_missed: { l4: 3 } });
  assert.deepEqual(result.current.teleop_missed, { l4: 3, l1: 0 });
  assert.equal(result.questions.find((q) => q.key === "teleop_missed")?.defaulted, true);
  // A fill that would break the tally's limits is not applied.
  const capped = contract([
    {
      ...missed,
      answer: { ...missed.answer, max: 3, maxTotal: 3 } as Question["answer"],
      default: 1,
    },
  ]);
  const full = evaluateAnswers(capped, { teleop_missed: { l4: 3 } });
  assert.deepEqual(full.current.teleop_missed, { l4: 3 });
  assert.equal(full.questions[0]?.defaulted, false);
});

test("an invalid answer is not replaced by the default", () => {
  const result = evaluateAnswers(all, { cycles: 99 });
  const cyclesResult = result.questions.find((q) => q.key === "cycles");
  assert.equal(cyclesResult?.state, "invalid");
  assert.equal(cyclesResult?.defaulted, false);
  assert.ok(!("cycles" in result.current));
});

test("defaults drive rules, and hidden questions do not use theirs", () => {
  const hidden = evaluateAnswers(all, { robot_status: "no_show" });
  const defenceResult = hidden.questions.find((q) => q.key === "played_defence");
  assert.equal(defenceResult?.visibility, "hidden");
  assert.equal(defenceResult?.value, null);
  assert.equal(defenceResult?.defaulted, false);
  assert.ok(!("played_defence" in hidden.current));
  // Without a stated status, the default "played" decides that defence is asked.
  const shown = evaluateAnswers(all, {});
  assert.equal(shown.questions.find((q) => q.key === "played_defence")?.visibility, "visible");
});

test("results mark defaulted answers and the model never sees defaults", () => {
  const result = finalizeTurns(all, [{ played_defence: true }]);
  assert.equal(result.fields.played_defence?.defaulted, undefined);
  assert.equal(result.fields.robot_status?.defaulted, true);
  assert.equal(result.values.robot_status, "played");
  // History keeps only what the scout stated.
  assert.deepEqual(Object.keys(result.history), ["played_defence"]);
  assert.ok(!JSON.stringify(modelContract(all)).includes('"default"'));
});
