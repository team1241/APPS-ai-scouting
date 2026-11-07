import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { advanceSession, createSessionWorkflow } from "./session.ts";

test("one durable run handles repeated follow-ups and replays without another extraction", async () => {
  const storage = new InMemoryStore();
  let calls = 0;
  const create = () => {
    const workflow = createSessionWorkflow(async (text) => {
      calls++;
      return finalizeExtraction({
        match: text.includes("match") ? "Q42" : null,
        team_number: text.includes("team") ? 1241 : null,
        climbed: text.includes("no climb") ? false : null,
        notes: null,
      });
    });
    new Mastra({ storage, workflows: { "scouting-session": workflow } });
    return workflow;
  };
  let workflow = create();
  const id = randomUUID();
  const turn = (text: string) => ({
    text,
    turnId: createHash("sha256").update(text).digest("hex"),
  });
  const first = turn("initial note");
  assert.equal((await advanceSession(workflow, id, first)).status, "needs_review");
  assert.equal((await advanceSession(workflow, id, first)).status, "needs_review");
  assert.equal(calls, 1);
  // Reconstruct the runtime against the same storage, as after process restart.
  workflow = create();
  const second = turn("initial note match team");
  assert.deepEqual((await advanceSession(workflow, id, second)).missing, ["climbed"]);
  assert.equal((await workflow.getWorkflowRunById(id))?.status, "suspended");
  assert.equal((await advanceSession(workflow, id, second)).status, "needs_review");
  assert.equal(calls, 2);
  const third = turn("initial note match team no climb");
  const result = await advanceSession(workflow, id, third);
  assert.equal(result.status, "complete");
  assert.equal(result.values.climbed, false);
  assert.deepEqual(await advanceSession(create(), id, third), result);
  assert.equal(calls, 3);
  await assert.rejects(advanceSession(workflow, id, turn("correction")), /correction session/);
  const other = randomUUID();
  assert.equal((await advanceSession(workflow, other, first)).status, "needs_review");
  assert.equal((await workflow.getWorkflowRunById(id))?.status, "success");
});

test("transient extractor failures preserve the run for a retry, and concurrent retries coalesce", async () => {
  let calls = 0;
  const workflow = createSessionWorkflow(async () => {
    calls++;
    if (calls === 1) throw Error("provider temporarily unavailable");
    return finalizeExtraction({ match: "Q1", team_number: 1241, climbed: false, notes: null });
  });
  new Mastra({ storage: new InMemoryStore(), workflows: { "scouting-session": workflow } });
  const id = randomUUID();
  const turn = { text: "Q1 1241 no climb", turnId: "a".repeat(64) };
  await assert.rejects(advanceSession(workflow, id, turn));
  assert.equal((await workflow.getWorkflowRunById(id))?.status, "suspended");
  const results = await Promise.all([
    advanceSession(workflow, id, turn),
    advanceSession(workflow, id, turn),
  ]);
  assert.equal(calls, 2);
  assert.ok(results.every((r) => r.status === "complete"));
});

test("backend validation can request another turn after complete extraction on the same run", async () => {
  const storage = new InMemoryStore();
  const create = () => {
    const workflow = createSessionWorkflow(async (text) =>
      finalizeExtraction({
        match: "Q1",
        team_number: text.includes("corrected") ? 1242 : 1241,
        climbed: false,
        notes: null,
      }),
    );
    new Mastra({ storage, workflows: { "scouting-session": workflow } });
    return workflow;
  };
  const id = randomUUID();
  const turn = { text: "complete note", turnId: "b".repeat(64), deferFinalization: true };
  const workflow = create();
  assert.equal((await advanceSession(workflow, id, turn)).status, "complete");
  assert.equal((await workflow.getWorkflowRunById(id))?.status, "suspended");
  assert.equal(
    (await advanceSession(create(), id, { ...turn, text: "corrected", turnId: "c".repeat(64) }))
      .values.team_number,
    1242,
  );
});
