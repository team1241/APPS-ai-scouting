import assert from "node:assert/strict";
import { test } from "node:test";
import general from "./examples/general.json" with { type: "json" };
import match from "./examples/match.json" with { type: "json" };
import pit from "./examples/pit.json" with { type: "json" };
import { type ContractIssueCode, readContract, requirements, validateContract } from "./index.ts";

const clone = <T>(value: T): T => structuredClone(value);
const codes = (input: unknown, kind?: "match" | "pit" | "general") => {
  const result = validateContract(input, kind);
  return result.ok ? [] : result.issues.map((i) => i.code);
};
const expectIssue = (input: unknown, code: ContractIssueCode, question?: string) => {
  const result = validateContract(input);
  assert.equal(result.ok, false, `expected ${code}`);
  const issue = result.ok ? undefined : result.issues.find((i) => i.code === code);
  assert.ok(issue, `expected ${code}, got ${JSON.stringify(result)}`);
  if (question) assert.equal(issue.question, question);
  return issue;
};
const question = (key: string) => match.questions.findIndex((q) => q.key === key);
// Test documents are edited as plain JSON.
interface Editable {
  key: string;
  required: boolean;
  answer: { type: string; options?: { code: string; label: string }[]; [key: string]: unknown };
  rules?: { effect: string; when: unknown }[];
}
const edit = (document: { questions: unknown[] }, key: string): Editable => {
  const found = (document.questions as Editable[]).find((q) => q.key === key);
  assert.ok(found, key);
  return found;
};
const options = (q: Editable) => {
  assert.ok(q.answer.options);
  return q.answer.options;
};

test("worked examples are valid for their kind", () => {
  assert.deepEqual(codes(match, "match"), []);
  assert.deepEqual(codes(pit, "pit"), []);
  assert.deepEqual(codes(general, "general"), []);
  assert.deepEqual(codes(match, "pit"), ["kind_mismatch"]);
});

test("legacy starter publications stay readable with their original semantics", () => {
  const contract = readContract(requirements);
  assert.equal(contract.formatVersion, 2);
  assert.equal(contract.version, requirements.version);
  assert.equal(contract.kind, "match");
  assert.deepEqual(
    contract.questions.map((q) => [q.key, q.answer.type, q.required, q.rules]),
    [
      ["match", "text", true, undefined],
      ["team_number", "number", true, undefined],
      ["climbed", "boolean", true, undefined],
      ["notes", "text", false, undefined],
    ],
  );
  assert.deepEqual(contract.questions[1]?.answer, { type: "number", format: "integer", min: 1 });
  assert.equal(contract.questions[2]?.prompt, requirements.fields[2]?.question);
  assert.equal(contract.questions[2]?.guidance, requirements.fields[2]?.description);
});

test("unknown formats and answer types fail closed", () => {
  assert.throws(
    () => readContract({ ...match, formatVersion: 3 }),
    /Unsupported contract format 3/,
  );
  const future = clone(match);
  (future.questions[2] as { answer: unknown }).answer = { type: "rating", max: 5 };
  expectIssue(future, "unsupported_type", "robot_status");
  assert.throws(() => readContract(null), /Invalid scouting contract/);
});

test("rejects duplicate codes and options", () => {
  const duplicate = clone(match);
  duplicate.questions.push(clone(edit(duplicate, "notes")) as never);
  expectIssue(duplicate, "duplicate_question", "notes");
  const option = clone(match);
  options(edit(option, "robot_status")).push({ code: "played", label: "Played again" });
  expectIssue(option, "duplicate_option", "robot_status");
  const label = clone(match);
  options(edit(label, "robot_status")).push({
    code: "played_2",
    label: "PLAYED",
  });
  expectIssue(label, "duplicate_option", "robot_status");
  const badCode = clone(match);
  edit(badCode, "notes").key = "Notes!";
  expectIssue(badCode, "invalid_structure");
});

test("rejects invalid constraints", () => {
  const reversed = clone(match);
  Object.assign(edit(reversed, "auto_pieces").answer, { min: 5, max: 2 });
  expectIssue(reversed, "invalid_constraint", "auto_pieces");
  const fractional = clone(match);
  Object.assign(edit(fractional, "auto_pieces").answer, { min: 0.5 });
  expectIssue(fractional, "invalid_constraint", "auto_pieces");
  const selection = clone(pit);
  Object.assign(edit(selection, "climb_levels").answer, { minSelected: 2, maxSelected: 1 });
  expectIssue(selection, "invalid_constraint", "climb_levels");
  const tooMany = clone(pit);
  Object.assign(edit(tooMany, "climb_levels").answer, { maxSelected: 4 });
  expectIssue(tooMany, "invalid_constraint", "climb_levels");
});

test("rejects unsupported comparisons, missing references and self references", () => {
  const set = (key: string, when: unknown, effect = "show") => {
    const copy = clone(match);
    (copy.questions[question(key)] as { rules: unknown }).rules = [{ effect, when }];
    return copy;
  };
  // Free text is never a condition source.
  expectIssue(
    set("climb_level", { question: "notes", operator: "equals", value: "x" }),
    "unsupported_comparison",
  );
  // Ordering does not apply to booleans or choices.
  expectIssue(
    set("climb_level", { question: "climbed", operator: "gt", value: true }),
    "unsupported_comparison",
  );
  // Typed values must match the upstream type.
  expectIssue(
    set("climb_level", { question: "climbed", operator: "equals", value: "yes" }),
    "unsupported_comparison",
  );
  expectIssue(
    set("climb_level", { question: "robot_status", operator: "in", value: "played" }),
    "unsupported_comparison",
  );
  expectIssue(
    set("climb_level", { question: "missing_q", operator: "equals", value: true }),
    "missing_reference",
  );
  expectIssue(
    set("climb_level", { question: "robot_status", operator: "equals", value: "gone" }),
    "missing_option",
  );
  expectIssue(
    set("climb_level", { question: "climb_level", operator: "equals", value: "low" }),
    "self_reference",
  );
  expectIssue(set("climb_level", { all: [] }), "invalid_structure");
  // An expression string is not a rule.
  expectIssue(set("climb_level", "climbed == true"), "invalid_structure");
});

test("upstream deletion and option removal are reported against the dependent rule", () => {
  const deleted = clone(match);
  deleted.questions.splice(question("climbed"), 1);
  const issue = expectIssue(deleted, "missing_reference", "climb_level");
  assert.deepEqual(issue.path.slice(0, 3), ["questions", question("climb_level") - 1, "rules"]);
  const option = clone(match);
  options(edit(option, "robot_status")).splice(1, 1);
  expectIssue(option, "missing_option", "climbed");
  const retyped = clone(match);
  edit(retyped, "climbed").answer = { type: "text" };
  expectIssue(retyped, "unsupported_comparison", "climb_level");
});

test("rejects cycles", () => {
  const cycle = clone(match);
  (cycle.questions[question("climbed")] as { rules: unknown }).rules = [
    { effect: "show", when: { question: "climb_level", operator: "equals", value: "low" } },
  ];
  expectIssue(cycle, "cycle");
  const longer = clone(match);
  (longer.questions[question("robot_status")] as { rules: unknown }).rules = [
    { effect: "hide", when: { question: "climb_level", operator: "equals", value: "low" } },
  ];
  assert.match(expectIssue(longer, "cycle").message, /robot_status/);
});

test("rejects conflicting and redundant rules", () => {
  const mixed = clone(match);
  (mixed.questions[question("climb_level")] as { rules: unknown[] }).rules.push({
    effect: "hide",
    when: { question: "robot_status", operator: "equals", value: "no_show" },
  });
  expectIssue(mixed, "conflicting_rules", "climb_level");
  const redundant = clone(match);
  (redundant.questions[question("climb_level")] as { rules: unknown[] }).rules.push({
    effect: "require",
    when: { question: "climbed", operator: "equals", value: true },
  });
  expectIssue(redundant, "redundant_rule", "climb_level");
});

test("protects identity by kind", () => {
  const hidden = clone(match);
  (hidden.questions[1] as { rules: unknown }).rules = [
    { effect: "hide", when: { question: "robot_status", operator: "equals", value: "no_show" } },
  ];
  expectIssue(hidden, "identity_protected", "team_number");
  const optional = clone(match);
  edit(optional, "match").required = false;
  expectIssue(optional, "identity_protected", "match");
  const missing = clone(match);
  missing.questions.splice(0, 1);
  expectIssue(missing, "identity_missing", "match");
  const retyped = clone(match);
  edit(retyped, "team_number").answer = { type: "number", format: "decimal", min: 1, max: 99999 };
  expectIssue(retyped, "identity_type", "team_number");
  const pitMatch = clone(pit);
  pitMatch.questions.unshift(clone(edit(match, "match")) as never);
  expectIssue(pitMatch, "identity_excluded", "match");
  // General observations may require a team conditionally but can never hide it.
  const generalHidden = clone(general);
  edit(generalHidden, "team_number").rules = [
    { effect: "show", when: { question: "topic", operator: "equals", value: "team" } },
  ];
  expectIssue(generalHidden, "identity_protected", "team_number");
});
