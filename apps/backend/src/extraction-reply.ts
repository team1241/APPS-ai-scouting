import type { ExtractionResult } from "@ai-scouting/scouting";

// The follow-up comes from the deterministic evaluation: identity first, then the remaining
// questions in contract order with their authored wording.
export function extractionReply(result: Pick<ExtractionResult, "status" | "question">): string {
  if (result.status === "complete") return "Saved! Thanks for scouting.";
  return result.question ?? "Your note is missing some information.";
}

export function outcomeLabel(outcome: string) {
  if (outcome === "validated") return "matches the schedule";
  if (outcome === "warning_acknowledged") return "saved with a warning";
  if (outcome === "unchecked") return "not checked against the schedule";
  return outcome.replaceAll("_", " ");
}
