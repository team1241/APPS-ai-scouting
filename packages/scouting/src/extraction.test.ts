import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeExtraction } from "./index.ts";

test("missing booleans prompt, explicit false completes, invalid fields fail", () => {
  const incomplete = finalizeExtraction({
    match: "Q42",
    team_number: 1241,
    climbed: null,
    notes: null,
  });
  assert.deepEqual(incomplete.missing, ["climbed"]);
  assert.equal(incomplete.status, "needs_review");
  assert.match(incomplete.question ?? "", /climb/);
  const complete = finalizeExtraction({
    match: "Q42",
    team_number: 1241,
    climbed: false,
    notes: null,
  });
  assert.equal(complete.status, "complete");
  assert.equal(complete.question, null);
  assert.throws(() =>
    finalizeExtraction({ match: "Q42", team_number: -1, climbed: true, notes: null }),
  );
});
