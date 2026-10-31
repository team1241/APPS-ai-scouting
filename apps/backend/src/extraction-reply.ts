import { type ExtractionResult, requirements } from "@ai-scouting/scouting";

export function extractionReply(result: ExtractionResult): string {
  if (result.status === "complete") return "Your scouting data has been saved. Thanks!";
  const identityKeys = new Set(["match", "team_number"]);
  const identityMissing = result.missing.some((key) => identityKeys.has(key));
  const questions = requirements.fields
    .filter(
      (field) =>
        result.missing.includes(field.key) &&
        (identityMissing ? identityKeys.has(field.key) : !identityKeys.has(field.key)),
    )
    .map((field) => field.question);
  return `${identityMissing ? "I need the match/team details for this note." : "Your note is missing some information."} ${questions.join(" ")}`;
}
