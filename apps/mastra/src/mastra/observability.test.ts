import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { createObservability } from "./observability.ts";
import { advanceSession, createSessionWorkflow } from "./workflows/session.ts";

test("session spans persist for Studio and the extractor receives the step context", async () => {
  const storage = new InMemoryStore();
  const observability = createObservability();
  const workflow = createSessionWorkflow(async (_text, context) => {
    assert.ok(context?.currentSpan, "extractor must inherit the workflow step span");
    return finalizeExtraction({ match: "Q1", team_number: 1241, climbed: false, notes: null });
  });
  new Mastra({ storage, observability, workflows: { "scouting-session": workflow } });
  const runId = randomUUID();
  try {
    await advanceSession(workflow, runId, { turnId: "a".repeat(64), text: "Q1 1241 no climb" });
    await observability.flush();
    const domain = await storage.getStore("observability");
    assert.ok(domain);
    const traces = await domain.listTraces({ filters: { runId } });
    assert.ok(traces.spans.length > 0, "workflow trace must be queryable by its run ID");
  } finally {
    await observability.shutdown();
  }
});
