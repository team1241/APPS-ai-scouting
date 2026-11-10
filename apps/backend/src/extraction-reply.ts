import type { ExtractionResult } from "@ai-scouting/scouting";

// The follow-up comes from the deterministic evaluation: identity first, then the remaining
// questions in contract order with their authored wording.
export function extractionReply(result: Pick<ExtractionResult, "status" | "question">): string {
  if (result.status === "complete") return "Your scouting data has been saved. Thanks!";
  return result.question ?? "Your note is missing some information.";
}
