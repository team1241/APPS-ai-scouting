// Exercise the actual Postgres snapshot adapter without any model/provider request.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { advanceSession, createSessionWorkflow } from "./mastra/workflows/session.ts";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.pathname.startsWith("/scouting_gh10_"),
  "Local disposable database required",
);
const store = new PostgresStore({
  id: "restore-drill",
  connectionString: url.toString(),
  schemaName: "mastra",
});
let calls = 0;
const workflow = createSessionWorkflow(async (text) => {
  calls++;
  return finalizeExtraction({
    match: "Q1",
    team_number: 1241,
    climbed: text === "completed" ? false : null,
    notes: null,
  });
});
new Mastra({ storage: store, workflows: { "scouting-session": workflow } });
const id = "10000000-0000-4000-8000-000000000010";
const turn = (text: string) => ({
  text,
  turnId: createHash("sha256").update(text).digest("hex"),
  deferFinalization: true,
});
try {
  if (process.argv[2] === "seed") {
    assert.equal((await advanceSession(workflow, id, turn("initial"))).status, "needs_review");
    assert.equal(calls, 1);
  } else if (process.argv[2] === "verify") {
    assert.equal((await workflow.getWorkflowRunById(id))?.status, "suspended");
    assert.equal((await advanceSession(workflow, id, turn("initial"))).status, "needs_review");
    assert.equal(calls, 0, "Restored turn must be cached");
    assert.equal((await advanceSession(workflow, id, turn("completed"))).status, "complete");
    assert.equal(
      (await workflow.getWorkflowRunById(id))?.status,
      "suspended",
      "Backend remains finalization authority",
    );
    assert.equal(calls, 1);
  } else throw Error("Use seed or verify");
  console.log(
    JSON.stringify({
      event: "mastra_recovery_drill",
      phase: process.argv[2],
      passed: true,
      simulatedModelCalls: calls,
    }),
  );
} finally {
  await store.close();
}
