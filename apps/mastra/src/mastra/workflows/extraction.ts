import {
  type Contract,
  type ExtractionMessage,
  modelContract,
  modelOutputSchema,
} from "@ai-scouting/scouting";
import type { TracingContext } from "@mastra/core/observability";
import { extractor } from "../agents/extractor.ts";
import { createSessionWorkflow } from "./session.ts";

// One model call over the contract and the messages. Production sessions and draft tests
// share it, so a test sees the same prompt, schema and model as scouts do.
export async function extractTurns(
  { contract, messages }: { contract: Contract; messages: ExtractionMessage[] },
  tracingContext?: TracingContext,
) {
  const response = await extractor.generate(
    JSON.stringify({
      contract: modelContract(contract),
      messages: messages.map((message, index) => ({ index, ...message })),
    }),
    {
      structuredOutput: { schema: modelOutputSchema(contract, messages.length) },
      tracingContext,
    },
  );
  return { turns: response.object.turns };
}

export const sessionWorkflow = createSessionWorkflow(extractTurns);
