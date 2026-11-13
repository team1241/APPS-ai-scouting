import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeTurns, readContract, requirements } from "@ai-scouting/scouting";
import { extractionReply } from "./extraction-reply.ts";

const contract = readContract(requirements);
const reply = (values: Record<string, unknown>) =>
  extractionReply(finalizeTurns(contract, [values]));

test("missing identity is asked separately before scouting metrics", () => {
  const text = reply({ match: null, team_number: null, climbed: null, notes: null });
  assert.match(text, /Which match/);
  assert.match(text, /Which team/);
  assert.doesNotMatch(text, /climb/);
});
test("only missing identity fields are requested", () => {
  const text = reply({ match: "Q42", team_number: null, climbed: null });
  assert.match(text, /Which team/);
  assert.doesNotMatch(text, /Which match|climb/);
});
test("known identity is not requested and remaining metrics follow", () => {
  const text = reply({ match: "Q42", team_number: 1241, climbed: null });
  assert.match(text, /climb/);
  assert.doesNotMatch(text, /Which match|Which team/);
  assert.match(reply({ match: "Q42", team_number: 1241, climbed: false }), /Saved!/);
});
