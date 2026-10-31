import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { extractionReply } from "./extraction-reply.ts";

test("missing identity is asked separately before scouting metrics", () => {
  const reply = extractionReply(
    finalizeExtraction({ match: null, team_number: null, climbed: null, notes: null }),
  );
  assert.match(reply, /Which match/);
  assert.match(reply, /Which team/);
  assert.doesNotMatch(reply, /climb/);
});
test("only missing identity fields are requested", () => {
  const reply = extractionReply(
    finalizeExtraction({ match: "Q42", team_number: null, climbed: null, notes: null }),
  );
  assert.match(reply, /Which team/);
  assert.doesNotMatch(reply, /Which match|climb/);
});
test("known identity is not requested and remaining metrics follow", () => {
  const reply = extractionReply(
    finalizeExtraction({ match: "Q42", team_number: 1241, climbed: null, notes: null }),
  );
  assert.match(reply, /climb/);
  assert.doesNotMatch(reply, /Which match|Which team/);
  assert.match(
    extractionReply(
      finalizeExtraction({ match: "Q42", team_number: 1241, climbed: false, notes: null }),
    ),
    /has been saved/,
  );
});
