import { modelContract, modelOutputSchema } from "@ai-scouting/scouting";
import { extractor } from "../agents/extractor.ts";
import { createSessionWorkflow } from "./session.ts";

export const sessionWorkflow = createSessionWorkflow(
  async ({ contract, messages }, tracingContext) => {
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
  },
);
