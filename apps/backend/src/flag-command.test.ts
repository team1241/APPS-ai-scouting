import assert from "node:assert/strict";
import { test } from "node:test";
import { matchLabelKey, parseFlagRequest } from "./flag-command.ts";

test("flags require a positive team and support optional match and free text", () => {
  assert.deepEqual(parseFlagRequest("1241"), { teamNumber: 1241, matchLabel: null, note: null });
  assert.deepEqual(parseFlagRequest("1241 42 wrong climb"), {
    teamNumber: 1241,
    matchLabel: "Q42",
    note: "wrong climb",
  });
  assert.deepEqual(parseFlagRequest("1241 Q42"), {
    teamNumber: 1241,
    matchLabel: "Q42",
    note: null,
  });
  assert.deepEqual(parseFlagRequest("1241 p14 wrong robot"), {
    teamNumber: 1241,
    matchLabel: "P14",
    note: "wrong robot",
  });
  assert.deepEqual(parseFlagRequest("1241 wrong climb\nplease check"), {
    teamNumber: 1241,
    matchLabel: null,
    note: "wrong climb\nplease check",
  });
  assert.deepEqual(parseFlagRequest("1241 -- 42 cycles was incorrect"), {
    teamNumber: 1241,
    matchLabel: null,
    note: "42 cycles was incorrect",
  });
  for (const input of [
    "",
    "wrong",
    "0",
    "-1",
    "1241 0",
    "1241 Q0",
    "1241 999999999999999999",
    "999999999999999999",
    `1241 ${"a".repeat(2001)}`,
  ])
    assert.equal(parseFlagRequest(input), null, input);
  assert.equal(matchLabelKey("Qualification match 42"), matchLabelKey("Q42"));
  assert.equal(matchLabelKey("P14"), "first:playoff:14");
});
