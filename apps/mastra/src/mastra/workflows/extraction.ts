import {
  extractionInputSchema,
  extractionResultSchema,
  extractionShape,
  finalizeExtraction,
} from "@ai-scouting/scouting";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { extractor } from "../agents/extractor.ts";

const extract = createStep({
  id: "extract-required-fields",
  inputSchema: extractionInputSchema,
  outputSchema: extractionResultSchema,
  execute: async ({ inputData }) => {
    const response = await extractor.generate(JSON.stringify({ scoutingNote: inputData.text }), {
      structuredOutput: { schema: extractionShape() },
    });
    return finalizeExtraction(response.object);
  },
});
export const extractionWorkflow = createWorkflow({
  id: "scouting-extraction",
  inputSchema: extractionInputSchema,
  outputSchema: extractionResultSchema,
})
  .then(extract)
  .commit();
