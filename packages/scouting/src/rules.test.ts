import assert from "node:assert/strict";
import { test } from "node:test";
import generalDocument from "./examples/general.json" with { type: "json" };
import matchDocument from "./examples/match.json" with { type: "json" };
import pitDocument from "./examples/pit.json" with { type: "json" };
import {
  checkAnswer,
  type Evaluation,
  evaluateAnswers,
  foldTurns,
  readContract,
  requirements,
} from "./index.ts";

const match = readContract(matchDocument, "match");
const pit = readContract(pitDocument, "pit");
const general = readContract(generalDocument, "general");
const identity = { match: "Q42", team_number: 1241 };
const played = {
  ...identity,
  robot_status: "played",
  auto_pieces: 3,
  climbed: true,
  climb_level: "mid",
  played_defence: false,
  cycle_speed: "fast",
};
const state = (evaluation: Evaluation, key: string) =>
  evaluation.questions.find((q) => q.key === key);
const byKey = (key: string) => {
  const found = match.questions.find((q) => q.key === key);
  assert.ok(found, key);
  return found;
};
const asked = (evaluation: Evaluation) => evaluation.followUps.map((f) => f.key);

test("climb -> climb level: shown only after a completed climb", () => {
  const climbed = evaluateAnswers(match, { ...played, climb_level: null });
  assert.equal(climbed.status, "incomplete");
  assert.deepEqual(asked(climbed), ["climb_level"]);
  assert.equal(climbed.followUps[0]?.prompt, "Which level did the robot climb to?");

  const noClimb = evaluateAnswers(match, { ...played, climbed: false, climb_level: null });
  assert.equal(noClimb.status, "complete");
  assert.equal(state(noClimb, "climb_level")?.visibility, "hidden");
  assert.equal(state(noClimb, "climb_level")?.requirement, "not_applicable");
  assert.equal(noClimb.current.climbed, false);
});

test("explicit boolean false and numeric zero are answers, not unknowns", () => {
  const result = evaluateAnswers(match, { ...played, auto_pieces: 0, climbed: false });
  assert.equal(result.status, "complete");
  assert.equal(result.current.auto_pieces, 0);
  assert.equal(result.current.climbed, false);
  assert.equal(result.current.played_defence, false);
  const missing = evaluateAnswers(match, { ...played, auto_pieces: null });
  assert.deepEqual(missing.missing, ["auto_pieces"]);
  // Bounds decide where zero is allowed: team numbers start at 1.
  assert.equal(checkAnswer(byKey("team_number"), 0).status, "invalid");
  assert.equal(checkAnswer(byKey("auto_pieces"), 0).status, "known");
});

test("conditional optionality: required text only when defence was played", () => {
  const noDefence = evaluateAnswers(match, played);
  assert.equal(state(noDefence, "defence_notes")?.requirement, "optional");
  assert.equal(noDefence.status, "complete");
  const defence = evaluateAnswers(match, { ...played, played_defence: true });
  assert.equal(state(defence, "defence_notes")?.requirement, "required");
  assert.deepEqual(asked(defence), ["defence_notes"]);
  // Unknown optional upstream: defence notes may be required, so ask the prerequisite.
  const unknownDefence = evaluateAnswers(match, { ...played, played_defence: null });
  assert.equal(state(unknownDefence, "defence_notes")?.requirement, "unknown");
  assert.deepEqual(unknownDefence.followUps, [
    {
      key: "played_defence",
      prompt: "Did the robot play defence?",
      reason: "prerequisite",
      identity: false,
    },
    {
      key: "defence_notes",
      prompt: "How effective was its defence?",
      reason: "missing",
      identity: false,
    },
  ]);
  // Answering the dependent directly is enough; the prerequisite is no longer needed.
  const answered = evaluateAnswers(match, {
    ...played,
    played_defence: null,
    defence_notes: "Strong",
  });
  assert.equal(answered.status, "complete");
  // Required by default, optional for a disabled robot.
  const disabled = evaluateAnswers(match, {
    ...played,
    robot_status: "disabled",
    cycle_speed: null,
  });
  assert.equal(state(disabled, "cycle_speed")?.requirement, "optional");
  assert.equal(disabled.status, "complete");
});

test("chained unknown conditions ask the root prerequisite without deadlock", () => {
  const result = evaluateAnswers(match, { ...identity, climb_level: "high" });
  assert.equal(result.status, "incomplete");
  assert.equal(state(result, "climbed")?.visibility, "unknown");
  assert.equal(state(result, "climbed")?.state, "pending");
  assert.equal(state(result, "climb_level")?.visibility, "unknown");
  // An answer whose applicability is unknown is not current yet.
  assert.equal(result.current.climb_level, undefined);
  assert.equal(asked(result)[0], "robot_status");
  assert.ok(!asked(result).includes("climbed"));
  // Resolving the chain step by step.
  const step = evaluateAnswers(match, { ...identity, robot_status: "played", climb_level: "high" });
  assert.equal(state(step, "climb_level")?.visibility, "unknown");
  assert.ok(asked(step).includes("climbed"));
  const done = evaluateAnswers(match, { ...played, climb_level: "high" });
  assert.equal(done.current.climb_level, "high");
  // A no-show hides the whole chain; unknown is never coerced to false.
  const noShow = evaluateAnswers(match, { ...identity, robot_status: "no_show" });
  assert.equal(noShow.status, "complete");
  assert.equal(state(noShow, "climb_level")?.visibility, "hidden");
});

test("every incomplete evaluation names at least one askable question", () => {
  const choices: Record<string, unknown[]> = {
    robot_status: [null, "played", "disabled", "no_show", "bogus"],
    auto_pieces: [null, 0, 99],
    climbed: [null, true, false],
    climb_level: [null, "low", "bogus"],
    played_defence: [null, true, false],
    defence_notes: [null, "Good"],
    cycle_speed: [null, "fast"],
  };
  let combinations = [{ ...identity } as Record<string, unknown>];
  for (const [key, values] of Object.entries(choices))
    combinations = combinations.flatMap((c) => values.map((v) => ({ ...c, [key]: v })));
  for (const values of combinations) {
    const result = evaluateAnswers(match, values);
    if (result.status === "complete") assert.equal(result.followUps.length, 0);
    else {
      assert.ok(result.followUps.length > 0, JSON.stringify(values));
      // Never ask a hidden question.
      for (const f of result.followUps) assert.notEqual(state(result, f.key)?.visibility, "hidden");
    }
  }
});

test("invalid answers are reported and asked again, never coerced", () => {
  const result = evaluateAnswers(match, { ...played, auto_pieces: 31, climb_level: "top" });
  assert.equal(state(result, "auto_pieces")?.state, "invalid");
  assert.equal(state(result, "auto_pieces")?.problem, "More than 30");
  assert.equal(result.current.auto_pieces, undefined);
  assert.deepEqual(
    result.followUps.map((f) => [f.key, f.reason]),
    [
      ["auto_pieces", "invalid"],
      ["climb_level", "invalid"],
    ],
  );
  assert.equal(checkAnswer(byKey("auto_pieces"), 2.5).status, "invalid");
  assert.equal(checkAnswer(byKey("auto_pieces"), "3").status, "invalid");
  assert.equal(checkAnswer(byKey("match"), "   ").status, "unknown");
});

test("identity follow-ups come first", () => {
  const result = evaluateAnswers(match, {
    ...played,
    match: null,
    team_number: null,
    climb_level: null,
  });
  assert.deepEqual(
    result.followUps.map((f) => [f.key, f.identity]),
    [
      ["match", true],
      ["team_number", true],
      ["climb_level", false],
    ],
  );
});

test("pit and general kinds use kind-specific identity and multiple choice", () => {
  const climbs = { team_number: 1241, drivetrain: "swerve", can_climb: true };
  assert.deepEqual(asked(evaluateAnswers(pit, climbs)), ["climb_levels"]);
  assert.equal(
    state(evaluateAnswers(pit, { ...climbs, climb_levels: [] }), "climb_levels")?.state,
    "invalid",
  );
  const complete = evaluateAnswers(pit, {
    ...climbs,
    climb_levels: ["low", "high"],
    weight_kg: 52.5,
  });
  assert.equal(complete.status, "complete");
  assert.deepEqual(complete.current.climb_levels, ["low", "high"]);
  assert.equal(evaluateAnswers(pit, { ...climbs, can_climb: false }).status, "complete");

  assert.equal(
    evaluateAnswers(general, { topic: "field", notes: "Bumpy field" }).status,
    "complete",
  );
  const team = evaluateAnswers(general, { topic: "team", notes: "Bumper fell off" });
  assert.deepEqual(
    team.followUps.map((f) => [f.key, f.identity]),
    [["team_number", true]],
  );
});

test("legacy starter keeps its original completeness semantics", () => {
  const starter = readContract(requirements);
  const result = evaluateAnswers(starter, {
    match: "Q42",
    team_number: 1241,
    climbed: false,
    notes: null,
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(evaluateAnswers(starter, { match: "Q42", team_number: 1241 }).missing, [
    "climbed",
  ]);
  assert.equal(
    state(evaluateAnswers(starter, { match: "Q42", team_number: -1, climbed: true }), "team_number")
      ?.state,
    "invalid",
  );
});

test("hidden answers stay in history and are excluded from current values", () => {
  const fold = foldTurns(match, [played, { climbed: false }]);
  assert.equal(fold.evaluation.status, "complete");
  assert.equal(fold.evaluation.current.climb_level, undefined);
  assert.deepEqual(fold.evaluation.inactive, { climb_level: "mid" });
  assert.deepEqual(fold.history.climb_level, [{ turn: 0, value: "mid", status: "inactive" }]);
  assert.deepEqual(fold.history.climbed, [
    { turn: 0, value: true, status: "superseded" },
    { turn: 1, value: false, status: "active" },
  ]);
});

test("reactivated questions start unknown until restated", () => {
  // Turn 1 hides climb level; turn 2 shows it again without restating it.
  const reactivated = foldTurns(match, [played, { climbed: false }, { climbed: true }]);
  assert.equal(reactivated.evaluation.status, "incomplete");
  assert.deepEqual(asked(reactivated.evaluation), ["climb_level"]);
  assert.equal(reactivated.evaluation.current.climb_level, undefined);
  assert.deepEqual(reactivated.evaluation.inactive, { climb_level: "mid" });
  assert.equal(reactivated.history.climb_level?.[0]?.status, "inactive");
  // Restating, even with the same value, makes it current again.
  const restated = foldTurns(match, [
    played,
    { climbed: false },
    { climbed: true },
    { climb_level: "mid" },
  ]);
  assert.equal(restated.evaluation.status, "complete");
  assert.equal(restated.evaluation.current.climb_level, "mid");
  assert.deepEqual(restated.evaluation.inactive, {});
  // A value stated in the reactivating turn is accepted.
  const sameTurn = foldTurns(match, [
    played,
    { climbed: false },
    { climbed: true, climb_level: "high" },
  ]);
  assert.equal(sameTurn.evaluation.current.climb_level, "high");
});

test("unknown applicability does not make an answer stale", () => {
  // Climb level stated before robot status is known: never hidden, so it stays usable.
  const fold = foldTurns(match, [
    { ...identity, climb_level: "low" },
    { robot_status: "played", climbed: true },
  ]);
  assert.equal(fold.evaluation.current.climb_level, "low");
});

test("corrections re-evaluate dependencies and null retracts", () => {
  const fold = foldTurns(match, [
    { ...played, played_defence: true, defence_notes: "Pinned well" },
    { played_defence: false },
    { played_defence: null },
  ]);
  assert.equal(state(fold.evaluation, "defence_notes")?.requirement, "unknown");
  // Answered dependent keeps the record complete even though its requirement is unknown.
  assert.equal(fold.evaluation.status, "complete");
  assert.equal(fold.evaluation.current.played_defence, undefined);
  assert.deepEqual(
    fold.history.played_defence?.map((h) => h.status),
    ["superseded", "superseded", "active"],
  );
});
