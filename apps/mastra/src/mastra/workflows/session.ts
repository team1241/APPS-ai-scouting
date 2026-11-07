import { extractionInputSchema, extractionResultSchema } from "@ai-scouting/scouting";
import type { TracingContext } from "@mastra/core/observability";
import { createStep, createWorkflow, createWorkflowStateReader } from "@mastra/core/workflows";
import { z } from "zod";

export const sessionTurnSchema = extractionInputSchema.extend({
  turnId: z.string().regex(/^[a-f0-9]{64}$/),
});
const suspensionSchema = z.object({
  turnId: z.string(),
  result: extractionResultSchema.nullable(),
});
const turnResultSchema = z.object({ turnId: z.string(), result: extractionResultSchema });
type Extract = (
  text: string,
  tracingContext?: TracingContext,
) => Promise<z.infer<typeof extractionResultSchema>>;

// Inject the extractor so persistence/resumption can be tested without model calls.
export function createSessionWorkflow(extract: Extract) {
  const collect = createStep({
    id: "collect-scouting-data",
    inputSchema: sessionTurnSchema,
    resumeSchema: sessionTurnSchema,
    suspendSchema: suspensionSchema,
    outputSchema: turnResultSchema,
    execute: async ({ inputData, resumeData, suspend, tracingContext }) => {
      const turn = resumeData ?? inputData;
      let result: z.infer<typeof extractionResultSchema>;
      try {
        result = await extract(turn.text, tracingContext);
      } catch {
        // Preserve the run on provider failure so the backend can retry this turn.
        return await suspend({ turnId: turn.turnId, result: null });
      }
      const output = { turnId: turn.turnId, result };
      if (result.status !== "complete") return await suspend(output);
      return output;
    },
  });
  return createWorkflow({
    id: "scouting-session",
    inputSchema: sessionTurnSchema,
    outputSchema: turnResultSchema,
  })
    .then(collect)
    .commit();
}

async function advance(
  workflow: ReturnType<typeof createSessionWorkflow>,
  runId: string,
  turn: z.infer<typeof sessionTurnSchema>,
) {
  const state = await workflow.getWorkflowRunById(runId);
  if (state) {
    const reader = createWorkflowStateReader(state);
    const prior =
      state.status === "success" ? reader.getResult() : reader.getSuspendedStep()?.suspendPayload;
    const cached = turnResultSchema.safeParse(prior);
    // A lost HTTP response must not execute an already persisted turn again.
    if (cached.success && cached.data.turnId === turn.turnId) return cached.data.result;
    if (state.status === "success")
      throw Error("Completed sessions require a new correction session");
    if (state.status !== "suspended")
      throw Error("Session is busy or failed; operator recovery required");
  }
  const run = await workflow.createRun({ runId });
  const execution = state
    ? await run.resume({ step: "collect-scouting-data", resumeData: turn })
    : await run.start({ inputData: turn });
  if (execution.status !== "success" && execution.status !== "suspended")
    throw Error("Session execution failed");
  // Read the persisted snapshot for the same recovery path used after a restart.
  const saved = await workflow.getWorkflowRunById(runId);
  if (!saved) throw Error("Session snapshot was not persisted");
  const reader = createWorkflowStateReader(saved);
  const output = turnResultSchema.parse(
    saved.status === "success" ? reader.getResult() : reader.getSuspendedStep()?.suspendPayload,
  );
  if (output.turnId !== turn.turnId) throw Error("Session turn mismatch");
  return output.result;
}

const pending = new WeakMap<
  object,
  Map<string, { turnId: string; promise: ReturnType<typeof advance> }>
>();

// Coalesce HTTP retries while a turn is still executing in this server process.
export function advanceSession(
  workflow: ReturnType<typeof createSessionWorkflow>,
  runId: string,
  turn: z.infer<typeof sessionTurnSchema>,
) {
  let runs = pending.get(workflow);
  if (!runs) {
    runs = new Map();
    pending.set(workflow, runs);
  }
  const existing = runs.get(runId);
  if (existing) {
    if (existing.turnId !== turn.turnId) return Promise.reject(Error("Session is busy"));
    return existing.promise;
  }
  const promise = advance(workflow, runId, turn).finally(() => runs.delete(runId));
  runs.set(runId, { turnId: turn.turnId, promise });
  return promise;
}
