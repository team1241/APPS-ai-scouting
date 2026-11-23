import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeTurns } from "@ai-scouting/scouting";
import pit from "@ai-scouting/scouting/examples/pit.json" with { type: "json" };
import {
  blankQuestion,
  codeFromLabel,
  conditionSources,
  defaultSummary,
  dependencies,
  editorIssue,
  editorIssues,
  ruleSentence,
  serializeQuestion,
  serializeQuestions,
  toEditorQuestions,
  validatedDraft,
} from "../src/lib/specification-model.ts";
import {
  answerFromInput,
  formatValue,
  latestStated,
  stateView,
  tallyFromInput,
} from "../src/lib/specification-preview.ts";

function item<T>(list: T[], index: number): T {
  const value = list[index];
  assert.ok(value !== undefined);
  return value;
}

test("a valid contract round-trips through the editor model without issues", () => {
  const questions = toEditorQuestions(pit.questions);
  assert.deepEqual(serializeQuestions(questions), pit.questions);
  assert.deepEqual(editorIssues("pit", "", questions), []);
  assert.deepEqual(dependencies(questions), [{ from: 2, to: 3, missing: false }]);
  const climb = questions[3];
  assert.ok(climb?.rules[0]);
  assert.equal(ruleSentence(climb.rules[0], questions), "Asked only when Can climb is Yes");
});

test("entered values are kept and problems are described per field", () => {
  const questions = toEditorQuestions(pit.questions);
  const weight = questions[4];
  const levels = questions[3];
  assert.ok(weight && levels);
  weight.answer.min = "abc";
  levels.answer.options[1] = { ...item(levels.answer.options, 0), id: "dup" };
  item(questions, 2).key = "drivetrain";
  // The typed value is still sent, so the server rejects it rather than dropping it.
  assert.equal((item(serializeQuestions(questions), 4).answer as { min: unknown }).min, "abc");
  const issues = editorIssues("pit", "", questions);
  const at = (id: string, field: string) =>
    issues.filter((i) => i.questionId === id && i.field === field).map((i) => i.message);
  assert.match(at(weight.id, "min")[0] ?? "", /number for the minimum/);
  assert.deepEqual(at(levels.id, "option:dup"), [
    "Another option is also labelled “Low”.",
    "Another option already uses the code “low”.",
  ]);
  assert.match(at(item(questions, 2).id, "key")[0] ?? "", /already uses the code “drivetrain”/);
  // The rule now points at a code that is shared, then at a missing one.
  item(questions, 2).key = "can_climb_now";
  assert.ok(
    editorIssues("pit", "", questions).some(
      (i) =>
        i.questionId === levels.id &&
        i.field === `rule:${levels.rules[0]?.id}` &&
        /“can_climb”, which is no longer in the specification/.test(i.message),
    ),
  );
});

test("identity and cycles come from the shared validator in plain words", () => {
  const questions = toEditorQuestions(pit.questions).slice(1);
  assert.ok(
    editorIssues("pit", "", questions).some((i) => /team number identity question/.test(i.message)),
  );
  const loop = toEditorQuestions(pit.questions);
  item(loop, 2).rules = [
    {
      id: "r",
      effect: "show",
      match: "all",
      comparisons: [{ id: "c", question: "climb_levels", operator: "includes", value: "low" }],
    },
  ];
  assert.ok(
    editorIssues("pit", "", loop).some((i) => /loop: Can climb → Climb levels/.test(i.message)),
  );
});

test("codes come from labels and stay unique", () => {
  assert.equal(codeFromLabel("Weight (kg)", []), "weight_kg");
  assert.equal(codeFromLabel("Weight (kg)", ["weight_kg"]), "weight_kg_2");
  assert.equal(codeFromLabel("2 robots", []), "question_2_robots");
  assert.equal(codeFromLabel("", []), "question");
});

test("publish and test issues link back to the question, rule or option", () => {
  const questions = toEditorQuestions(pit.questions);
  const climb = item(questions, 3);
  const levels = climb.answer.options;
  const rule = editorIssue(
    {
      code: "missing_option",
      path: ["questions", 3, "rules", 0, "when"],
      question: "climb_levels",
      message: "x",
    },
    questions,
  );
  assert.deepEqual(rule, {
    questionId: climb.id,
    field: `rule:${item(climb.rules, 0).id}`,
    message: "x",
  });
  const option = editorIssue(
    {
      code: "invalid_structure",
      path: ["questions", 3, "answer", "options", 1, "label"],
      message: "y",
    },
    questions,
  );
  assert.equal(option.field, `option:${item(levels, 1).id}`);
  const unplaced = editorIssue(
    { code: "identity_missing", path: ["questions"], question: "team_number", message: "z" },
    [],
  );
  assert.equal(unplaced.field, "questions");
});

test("preview helpers describe values and states in plain words", () => {
  const validation = validatedDraft("pit", "", toEditorQuestions(pit.questions));
  assert.ok(validation.ok);
  const levels = validation.contract.questions[3];
  const weight = validation.contract.questions[4];
  assert.ok(levels && weight);
  assert.equal(formatValue(levels, ["low", "high"]), "Low, High");
  assert.equal(formatValue(levels, []), "None of these");
  assert.equal(formatValue(levels, null), "Withdrawn or not known");
  assert.equal(formatValue(undefined, false), "No");
  assert.equal(answerFromInput(weight, " 52.5 "), 52.5);
  assert.equal(answerFromInput(weight, "abc"), "abc");
  assert.equal(answerFromInput(weight, ""), null);
  assert.deepEqual(stateView({ state: "inactive", requirement: "not_applicable" }), {
    tone: "neutral",
    label: "Not asked",
  });
});

test("a tally question can be added to an existing draft", () => {
  const questions = toEditorQuestions(pit.questions);
  const tally = blankQuestion(questions);
  Object.assign(tally, {
    key: "coral_scored",
    label: "Coral scored",
    prompt: "How many coral did the robot score on each level?",
    guidance: "Coral placed on the reef.",
  });
  tally.answer = {
    ...tally.answer,
    type: "tally",
    max: "12",
    maxTotal: "20",
    options: [
      { id: "a", code: "l1", label: "Level 1", codeLocked: true },
      { id: "b", code: "l4", label: "Level 4", codeLocked: true },
    ],
  };
  const draft = [...questions, tally];
  assert.deepEqual(editorIssues("pit", "", draft), []);
  const serialized = serializeQuestions(draft).at(-1);
  assert.deepEqual(serialized?.answer, {
    type: "tally",
    options: [
      { code: "l1", label: "Level 1" },
      { code: "l4", label: "Level 4" },
    ],
    max: 12,
    maxTotal: 20,
  });
  // A saved tally reads back into the editor unchanged.
  assert.deepEqual(
    serializeQuestions(toEditorQuestions(serializeQuestions(draft))),
    serializeQuestions(draft),
  );
  // Rules cannot depend on a tally.
  assert.ok(!conditionSources(item(draft, 0), draft).some((q) => q.key === "coral_scored"));

  tally.answer = { ...tally.answer, max: "30", options: [] };
  const fields = editorIssues("pit", "", draft)
    .filter((i) => i.questionId === tally.id)
    .map((i) => i.field);
  assert.deepEqual(fields.sort(), ["max", "options"]);

  assert.deepEqual(tallyFromInput({ l1: "2", l4: "", l2: "x" }), { l1: 2, l2: "x" });
  assert.equal(tallyFromInput({ l1: " " }), null);
  const contract = validatedDraft("pit", "", [
    ...questions,
    {
      ...tally,
      answer: {
        ...tally.answer,
        max: "",
        options: [
          { id: "a", code: "l1", label: "Level 1", codeLocked: true },
          { id: "b", code: "l4", label: "Level 4", codeLocked: true },
        ],
      },
    },
  ]);
  assert.ok(contract.ok);
  const question = contract.contract.questions.at(-1);
  assert.equal(formatValue(question, { l1: 2 }), "Level 1: 2");
  // The test view shows the merged tally, not only the last message's counts.
  const result = finalizeTurns(contract.contract, [
    { coral_scored: { l1: 2 } },
    { coral_scored: { l4: 3 } },
    { team_number: 0 },
  ]);
  assert.deepEqual(latestStated(result).coral_scored, { l1: 2, l4: 3 });
  // Values production does not use still show as stated.
  assert.equal(latestStated(result).team_number, 0);
});

test("default answers round-trip, validate and read in plain words", () => {
  const questions = toEditorQuestions(pit.questions);
  const climb = questions.find((q) => q.answer.type === "boolean");
  const choice = questions.find((q) => q.answer.type === "single_choice");
  const number = questions.find((q) => q.answer.type === "number" && q.key !== "team_number");
  assert.ok(climb && choice && number);
  climb.defaultValue = "false";
  choice.defaultValue = item(choice.answer.options, 0).code;
  number.defaultValue = number.answer.min.trim() || "0";
  assert.deepEqual(editorIssues("pit", "", questions), []);
  const serialized = serializeQuestions(questions);
  assert.equal(serialized.find((q) => q.key === climb.key)?.default, false);
  assert.equal(serialized.find((q) => q.key === choice.key)?.default, choice.defaultValue);
  assert.equal(typeof serialized.find((q) => q.key === number.key)?.default, "number");
  assert.deepEqual(serializeQuestions(toEditorQuestions(serialized)), serialized);
  assert.equal(defaultSummary(climb), "No");
  assert.equal(defaultSummary(choice), item(choice.answer.options, 0).label);
  // Problems are placed on the default field.
  choice.defaultValue = "missing";
  number.defaultValue = "abc";
  const fields = editorIssues("pit", "", questions)
    .filter((i) => i.field === "default")
    .map((i) => i.questionId);
  assert.deepEqual(fields.sort(), [choice.id, number.id].sort());
  // Types without default support never send one.
  const text = questions.find((q) => q.answer.type === "text");
  if (text) {
    text.defaultValue = "anything";
    assert.equal(serializeQuestion(text, questions).default, undefined);
  }
});
