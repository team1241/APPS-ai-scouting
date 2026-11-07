import { extractionShape, finalizeExtraction } from "@ai-scouting/scouting";
import { extractor } from "../agents/extractor.ts";
import { createSessionWorkflow } from "./session.ts";

export const sessionWorkflow = createSessionWorkflow(async (text, tracingContext) => {
  const response = await extractor.generate(JSON.stringify({ scoutingNote: text }), {
    structuredOutput: { schema: extractionShape() },
    tracingContext,
  });
  return finalizeExtraction(response.object);
});
