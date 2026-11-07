import { extractionShape, finalizeExtraction, requirements } from "@ai-scouting/scouting";
import { extractor } from "../agents/extractor.ts";
import { createSessionWorkflow } from "./session.ts";

export const sessionWorkflow = createSessionWorkflow(
  async (text, tracingContext, specification = requirements) => {
    const response = await extractor.generate(
      JSON.stringify({ requirements: specification, scoutingNote: text }),
      {
        structuredOutput: { schema: extractionShape(specification) },
        tracingContext,
      },
    );
    return finalizeExtraction(response.object, specification);
  },
);
