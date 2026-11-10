import assert from "node:assert/strict";
import { test } from "node:test";
import match from "@ai-scouting/scouting/examples/match.json" with { type: "json" };
import { runDraftTest } from "./draft-test.ts";

const messages = [{ role: "note", text: "Q1 team 1241 played" }];

test("a valid draft runs one extraction and returns per-message statements", async () => {
  let calls = 0;
  const result = await runDraftTest(
    async ({ messages: sent }) => {
      calls++;
      return { turns: sent.map(() => ({ match: "Q1" })) };
    },
    { contract: match, messages },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    status: 200,
    body: { specificationVersion: match.version, turns: [{ match: "Q1" }] },
  });
});

test("invalid contracts and oversized samples never reach the model", async () => {
  const never = async () => assert.fail("model called");
  const broken = { ...match, questions: [] };
  assert.equal((await runDraftTest(never, { contract: broken, messages })).status, 400);
  const long = [{ role: "note", text: "x".repeat(2001) }];
  assert.equal((await runDraftTest(never, { contract: match, messages: long })).status, 400);
});

test("provider failures are reported without detail", async () => {
  const result = await runDraftTest(
    async () => {
      throw Error("provider said: Q1 team 1241 played");
    },
    { contract: match, messages },
  );
  assert.deepEqual(result, { status: 503, body: { error: "Extraction model unavailable" } });
});
