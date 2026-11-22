import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import generalDocument from "./examples/general.json" with { type: "json" };
import matchDocument from "./examples/match.json" with { type: "json" };
import pitDocument from "./examples/pit.json" with { type: "json" };
import {
  extractionRequestSchema,
  finalizeTurns,
  LIMITS,
  modelContract,
  modelOutputSchema,
  readContract,
  requirements,
  turnsFromModelOutput,
} from "./index.ts";

const match = readContract(matchDocument, "match");
const pit = readContract(pitDocument, "pit");
const general = readContract(generalDocument, "general");
const legacy = readContract(requirements);
const identity = { match: "Q42", team_number: 1241 };

test("format 1 keeps its behaviour: missing boolean asks, explicit false completes", () => {
  const incomplete = finalizeTurns(legacy, [{ ...identity, climbed: null, notes: null }]);
  assert.deepEqual(incomplete.missing, ["climbed"]);
  assert.equal(incomplete.status, "needs_review");
  assert.match(incomplete.question ?? "", /climb/);
  const complete = finalizeTurns(legacy, [{ ...identity, climbed: false }]);
  assert.equal(complete.status, "complete");
  assert.equal(complete.question, null);
  assert.equal(complete.values.climbed, false);
  // A negative team is invalid and asked again; it is never coerced or dropped silently.
  const invalid = finalizeTurns(legacy, [{ match: "Q42", team_number: -1, climbed: true }]);
  assert.equal(invalid.status, "needs_review");
  assert.equal(invalid.fields.team_number?.state, "invalid");
  assert.match(invalid.question ?? "", /Team number \(Less than 1\)/);
});

test("structured output is a list of answers per message", () => {
  const schema = modelOutputSchema(match, 2);
  const json = z.toJSONSchema(schema) as unknown as {
    properties: {
      turns: {
        minItems: number;
        maxItems: number;
        items: {
          properties: {
            answers: { items: { properties: { question: { enum: string[] } } } };
          };
        };
      };
    };
  };
  assert.equal(json.properties.turns.minItems, 2);
  assert.equal(json.properties.turns.maxItems, 2);
  assert.deepEqual(
    json.properties.turns.items.properties.answers.items.properties.question.enum,
    match.questions.map((q) => q.key),
  );
  // Values stay loosely typed so the application, not the schema, rejects bad answers.
  const output = {
    turns: [
      { answers: [{ question: "auto_pieces", value: 99 }] },
      { answers: [{ question: "climb_level", value: "roof" }] },
    ],
  };
  assert.ok(schema.safeParse(output).success);
  assert.ok(
    !schema.safeParse({ turns: [{ answers: [{ question: "unknown", value: 1 }] }] }).success,
  );
  assert.ok(!schema.safeParse({ turns: [{ answers: [] }] }).success);
  assert.deepEqual(turnsFromModelOutput(match, schema.parse(output)), [
    { auto_pieces: 99 },
    { climb_level: "roof" },
  ]);
  // Guidance, answer types and option codes reach the model through the contract view.
  const view = modelContract(match);
  const climb = view.questions.find((q) => q.key === "climb_level");
  assert.match(climb?.answer ?? "", /low \(Low\), mid \(Mid\), high \(High\)/);
  assert.match(climb?.guidance ?? "", /level the robot finished on/);
  assert.match(view.questions.find((q) => q.key === "auto_pieces")?.answer ?? "", /from 0 to 30/);
  assert.ok(view.questions.every((q) => !("rules" in q)));
  assert.equal(view.questions[0]?.followUpQuestion, match.questions[0]?.prompt);
});

// The provider rejects a structured-output schema with more than 16 nullable (union) fields
// or 24 optional fields. The schema must not grow with the number of questions or options.
test("the output schema size does not depend on the number of questions", () => {
  const tally = (i: number) => ({
    key: `tally_${i}`,
    label: `Tally ${i}`,
    prompt: `How many for tally ${i}?`,
    guidance: "Only when stated.",
    required: false,
    answer: {
      type: "tally" as const,
      options: Array.from({ length: 4 }, (_, j) => ({ code: `o${j}`, label: `Option ${j}` })),
    },
  });
  const extra = (i: number) => ({
    key: `extra_${i}`,
    label: `Extra ${i}`,
    prompt: `Extra question ${i}?`,
    guidance: "Only when stated.",
    required: false,
    answer: { type: "boolean" as const },
  });
  const questions = [...match.questions];
  for (let i = 0; questions.length < LIMITS.questions; i++)
    questions.push(i % 2 ? tally(i) : extra(i));
  const large = readContract({ ...match, questions }, "match");
  const count = (node: unknown): { unions: number; optional: number } => {
    const total = { unions: 0, optional: 0 };
    if (Array.isArray(node)) {
      for (const item of node) {
        const inner = count(item);
        total.unions += inner.unions;
        total.optional += inner.optional;
      }
      return total;
    }
    if (node === null || typeof node !== "object") return total;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.anyOf)) total.unions += 1;
    if (record.properties && typeof record.properties === "object") {
      const required = new Set(Array.isArray(record.required) ? record.required : []);
      total.optional += Object.keys(record.properties).filter((k) => !required.has(k)).length;
    }
    for (const value of Object.values(record)) {
      const inner = count(value);
      total.unions += inner.unions;
      total.optional += inner.optional;
    }
    return total;
  };
  const small = count(z.toJSONSchema(modelOutputSchema(match, 6)));
  assert.deepEqual(count(z.toJSONSchema(modelOutputSchema(large, 6))), small);
  assert.ok(small.unions <= 16 && small.optional <= 24);
});

test("requests carry a validated contract and bounded scout messages", () => {
  const turnId = "a".repeat(64);
  const message = { role: "note", text: "Q42 1241 climbed mid" };
  assert.ok(
    extractionRequestSchema.safeParse({ turnId, contract: match, messages: [message] }).success,
  );
  assert.ok(!extractionRequestSchema.safeParse({ turnId, contract: match, messages: [] }).success);
  assert.ok(
    !extractionRequestSchema.safeParse({
      turnId,
      contract: { ...match, questions: [] },
      messages: [message],
    }).success,
  );
});

test("linked replies re-run rules: conditional questions, zero, false and choices", () => {
  const played = {
    ...identity,
    robot_status: "played",
    auto_pieces: 0,
    played_defence: false,
    cycle_speed: "fast",
  };
  const first = finalizeTurns(match, [{ ...played, climbed: true }]);
  assert.equal(first.status, "needs_review");
  assert.deepEqual(
    first.followUps.map((f) => f.key),
    ["climb_level"],
  );
  assert.equal(first.values.auto_pieces, 0);
  assert.equal(
    first.question,
    "Your note is missing some information. Which level did the robot climb to?",
  );
  // An unlisted option is invalid and asked again with the reason.
  const roof = finalizeTurns(match, [{ ...played, climbed: true }, { climb_level: "roof" }]);
  assert.equal(roof.fields.climb_level?.state, "invalid");
  assert.match(roof.question ?? "", /Climb level \(Not one of the options\)/);
  const done = finalizeTurns(match, [{ ...played, climbed: true }, { climb_level: "mid" }]);
  assert.equal(done.status, "complete");
  assert.deepEqual(done.turns, [{ ...played, climbed: true }, { climb_level: "mid" }]);
  // "Did not climb" hides the level. The old value stays in history and inactive.
  const changed = finalizeTurns(match, [
    { ...played, climbed: true, climb_level: "mid" },
    { climbed: false },
  ]);
  assert.equal(changed.status, "complete");
  assert.equal(changed.fields.climb_level?.state, "inactive");
  assert.equal(changed.inactive.climb_level, "mid");
  assert.ok(!Object.hasOwn(changed.values, "climb_level"));
  assert.equal(changed.history.climb_level?.[0]?.status, "inactive");
  // Shown again: the stale level is not current until restated.
  const back = finalizeTurns(match, [
    { ...played, climbed: true, climb_level: "mid" },
    { climbed: false },
    { climbed: true },
  ]);
  assert.equal(back.status, "needs_review");
  assert.deepEqual(back.missing, ["climb_level"]);
  assert.equal(back.inactive.climb_level, "mid");
});

test("unresolved prerequisites are asked; identity goes first and alone", () => {
  const level = finalizeTurns(match, [{ climb_level: "high" }]);
  assert.equal(level.fields.climb_level?.state, "pending");
  assert.ok(level.followUps.some((f) => f.key === "robot_status"));
  assert.match(level.question ?? "", /^I need the match\/team details for this note\./);
  assert.ok(!(level.question ?? "").includes("robot play"));
  const withIdentity = finalizeTurns(match, [{ ...identity, climb_level: "high" }]);
  assert.match(withIdentity.question ?? "", /Did the robot play, break down or not show up\?/);
  assert.ok(!(withIdentity.question ?? "").includes("Which level"));
});

test("statements outside the contract and undefined values are ignored", () => {
  const result = finalizeTurns(match, [{ ...identity, injected: "drop tables", notes: undefined }]);
  assert.ok(!Object.hasOwn(result.turns[0] ?? {}, "injected"));
  assert.ok(!Object.hasOwn(result.turns[0] ?? {}, "notes"));
});

test("pit and general use kind identity and need no match", () => {
  const pitResult = finalizeTurns(pit, [{}]);
  assert.match(pitResult.question ?? "", /^I need the team number for this pit note\./);
  const generalResult = finalizeTurns(general, [{}]);
  assert.equal(generalResult.kind, "general");
  assert.ok(!generalResult.missing.includes("match"));
});
