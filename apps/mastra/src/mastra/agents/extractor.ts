import { extractionInstructions } from "@ai-scouting/scouting";
import { Agent } from "@mastra/core/agent";

// The contract and scout messages arrive per request. The agent only reports statements;
// the backend validates values, runs rules and decides follow-ups.
export const extractor = new Agent({
  id: "scouting-extractor",
  name: "Scouting extractor",
  model: "anthropic/claude-haiku-5-5",
  instructions: extractionInstructions,
});
