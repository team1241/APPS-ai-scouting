import assert from "node:assert/strict";
import { test } from "node:test";
import pit from "@ai-scouting/scouting/examples/pit.json" with { type: "json" };
import {
  codeFromLabel,
  dependencies,
  editorIssue,
  editorIssues,
  ruleSentence,
  serializeQuestions,
  toEditorQuestions,
  validatedDraft,
} from "../src/lib/specification-model.ts";
import { answerFromInput, formatValue, stateView } from "../src/lib/specification-preview.ts";

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
