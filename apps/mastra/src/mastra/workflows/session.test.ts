import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { type ExtractionMessage, readContract, requirements } from "@ai-scouting/scouting";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { advanceSession, createSessionWorkflow } from "./session.ts";

const contract = readContract(requirements);
const turn = (...texts: string[]) => {
  const messages: ExtractionMessage[] = texts.map((text, i) => ({
    role: i ? "reply" : "note",
    text,
  }));
  return {
    contract,
    messages,
    turnId: createHash("sha256").update(JSON.stringify(messages)).digest("hex"),
  };
};
// Reports what each message states, as the model would.
const statements = (messages: ExtractionMessage[]) =>
  messages.map((m) => ({
    ...(m.text.includes("match") ? { match: "Q42" } : {}),
    ...(m.text.includes("team") ? { team_number: 1241 } : {}),
    ...(m.text.includes("no climb") ? { climbed: false } : {}),
  }));

test("one durable run handles repeated follow-ups and replays without another extraction", async () => {
  const storage = new InMemoryStore();
  let calls = 0;
  const create = () => {
    const workflow = createSessionWorkflow(async ({ messages }) => {
      calls++;
      return { turns: statements(messages) };
    });
    new Mastra({ storage, workflows: { "scouting-session": workflow } });
    return workflow;
  };
  let workflow = create();
  const id = randomUUID();
  const first = turn("initial note");
  assert.deepEqual((await advanceSession(workflow, id, first)).turns, [{}]);
  assert.deepEqual((await advanceSession(workflow, id, first)).turns, [{}]);
  assert.equal(calls, 1);
  // Reconstruct the runtime against the same storage, as after process restart.
  workflow = create();
  const second = turn("initial note", "match team");
  assert.deepEqual((await advanceSession(workflow, id, second)).turns, [
    {},
    { match: "Q42", team_number: 1241 },
  ]);
  assert.equal((await workflow.getWorkflowRunById(id))?.status, "suspended");
  await advanceSession(workflow, id, second);
  assert.equal(calls, 2);
  const third = turn("initial note", "match team", "no climb");
  const result = await advanceSession(workflow, id, third);
  assert.equal(result.specificationVersion, requirements.version);
  assert.deepEqual(result.turns[2], { climbed: false });
  assert.deepEqual(await advanceSession(create(), id, third), result);
  assert.equal(calls, 3);
  // The backend decides completeness, so the run stays open for later replies.
  assert.equal((await workflow.getWorkflowRunById(id))?.status, "suspended");
});

test("transient extractor failures preserve the run for a retry, and concurrent retries coalesce", async () => {
  let calls = 0;
  const workflow = createSessionWorkflow(async ({ messages }) => {
    calls++;
    if (calls === 1) throw Error("provider temporarily unavailable");
    return { turns: statements(messages) };
  });
  new Mastra({ storage: new InMemoryStore(), workflows: { "scouting-session": workflow } });
  const id = randomUUID();
  const request = turn("match team no climb");
  await assert.rejects(advanceSession(workflow, id, request));
  assert.equal((await workflow.getWorkflowRunById(id))?.status, "suspended");
  const results = await Promise.all([
    advanceSession(workflow, id, request),
    advanceSession(workflow, id, request),
  ]);
  assert.equal(calls, 2);
  assert.ok(results.every((r) => r.turns[0]?.climbed === false));
});

test("a model response with the wrong number of turns is rejected and retried", async () => {
  let calls = 0;
  const workflow = createSessionWorkflow(async ({ messages }) => {
    calls++;
    return { turns: calls === 1 ? [] : statements(messages) };
  });
  new Mastra({ storage: new InMemoryStore(), workflows: { "scouting-session": workflow } });
  const id = randomUUID();
  const request = turn("match team");
  await assert.rejects(advanceSession(workflow, id, request));
  assert.equal((await advanceSession(workflow, id, request)).turns.length, 1);
});
