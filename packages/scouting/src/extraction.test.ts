import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import generalDocument from "./examples/general.json" with { type: "json" };
import matchDocument from "./examples/match.json" with { type: "json" };
import pitDocument from "./examples/pit.json" with { type: "json" };
import {
  extractionRequestSchema,
  finalizeTurns,
  modelContract,
  modelOutputSchema,
  readContract,
  requirements,
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

test("structured output derives from types, option codes and guidance", () => {
  const schema = modelOutputSchema(match, 2);
  const json = z.toJSONSchema(schema) as unknown as {
    properties: { turns: { minItems: number; maxItems: number; items: { properties: object } } };
  };
  assert.equal(json.properties.turns.minItems, 2);
  assert.equal(json.properties.turns.maxItems, 2);
  const props = json.properties.turns.items.properties as Record<
    string,
    { description?: string; anyOf?: { type: string }[] }
  >;
  assert.deepEqual(
    Object.keys(props),
    match.questions.map((q) => q.key),
  );
  assert.match(props.climb_level?.description ?? "", /low \(Low\), mid \(Mid\), high \(High\)/);
  assert.match(props.climb_level?.description ?? "", /level the robot finished on/);
  assert.match(props.auto_pieces?.description ?? "", /from 0 to 30/);
  // Values stay loosely typed so the application, not the schema, rejects bad answers.
  assert.ok(schema.safeParse({ turns: [{ auto_pieces: 99 }, { climb_level: "roof" }] }).success);
  assert.ok(!schema.safeParse({ turns: [{}] }).success);
  const view = modelContract(match);
  assert.ok(view.questions.every((q) => !("rules" in q)));
  assert.equal(view.questions[0]?.followUpQuestion, match.questions[0]?.prompt);
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
