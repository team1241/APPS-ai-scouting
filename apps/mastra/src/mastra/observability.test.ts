import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { Mastra } from "@mastra/core/mastra";
import { type AnyExportedSpan, SpanType, TracingEventType } from "@mastra/core/observability";
import { InMemoryStore } from "@mastra/core/storage";
import { createObservability, privateSpan, privateTraceExporter } from "./observability.ts";
import { advanceSession, createSessionWorkflow } from "./workflows/session.ts";

test("extraction persists recovery state with content-free traces", async () => {
  const storage = new InMemoryStore();
  const observability = createObservability();
  assert.equal(observability.listInstances().size, 1);
  const workflow = createSessionWorkflow(async (_text, context) => {
    assert.ok(context?.currentSpan);
    return finalizeExtraction({ match: "Q1", team_number: 1241, climbed: false, notes: null });
  });
  new Mastra({ storage, observability, workflows: { "scouting-session": workflow } });
  const runId = randomUUID();
  try {
    await advanceSession(workflow, runId, {
      turnId: "a".repeat(64),
      text: "Q1 1241 no climb. Private scout: Alice +1-416-555-0101",
    });
    await observability.flush();
    const domain = await storage.getStore("observability");
    assert.ok(domain);
    const traces = await domain.listTraces({ filters: { runId } });
    assert.ok(traces.spans.length > 0, "run must remain queryable in Studio");
    assert.ok(!JSON.stringify(traces).includes("Alice"));
    assert.ok(!JSON.stringify(traces).includes("555-0101"));
    assert.ok(await workflow.getWorkflowRunById(runId), "recovery snapshot remains available");
  } finally {
    await observability.shutdown();
  }
});

test("export boundary drops untrusted content from every payload surface", async () => {
  const secret = "Alice telegram:123456 alice@example.com";
  const runId = randomUUID();
  const raw: AnyExportedSpan = {
    id: "0123456789abcdef",
    traceId: "0123456789abcdef0123456789abcdef",
    name: secret,
    type: SpanType.MODEL_GENERATION,
    startTime: new Date(),
    endTime: new Date(),
    isEvent: false,
    isRootSpan: true,
    input: secret,
    output: { notes: secret },
    requestContext: { user: secret },
    metadata: { runId, userId: secret, nested: { profile: secret } },
    attributes: {
      model: secret,
      usage: { inputTokens: 42, outputTokens: 7 },
      instructions: secret,
    },
    tags: [secret],
    entityName: secret,
    rootEntityName: secret,
    inputPreview: secret,
    outputPreview: secret,
    errorPreview: secret,
    errorInfo: { message: secret, stack: secret, details: { body: secret } },
    stopReasonContext: { text: secret },
  };
  const safe = privateSpan(raw);
  assert.ok(!JSON.stringify(safe).includes(secret));
  assert.deepEqual(safe.metadata, { runId });
  assert.deepEqual(safe.attributes, { usage: { inputTokens: 42, outputTokens: 7 } });
  assert.equal(safe.errorInfo?.message, "Operation failed");
  assert.equal(safe.startTime, raw.startTime);
  assert.equal(raw.input, secret, "must not mutate workflow/debug state");
  assert.deepEqual(privateSpan({ ...raw, metadata: { runId: secret } }).metadata, {});

  const received: unknown[] = [];
  const exporter = privateTraceExporter({
    name: "capture",
    exportTracingEvent: async (event) => {
      received.push(event);
    },
    flush: async () => {},
    shutdown: async () => {},
  });
  for (const type of Object.values(TracingEventType)) {
    await exporter.exportTracingEvent({ type, exportedSpan: raw });
    await exporter.onTracingEvent?.({ type, exportedSpan: raw });
  }
  assert.equal(received.length, 6);
  assert.ok(!JSON.stringify(received).includes(secret));
  assert.equal(exporter.onLogEvent, undefined);
  assert.equal(exporter.onMetricEvent, undefined);
  assert.equal(exporter.onScoreEvent, undefined);
  assert.equal(exporter.onFeedbackEvent, undefined);
});
