import type { ReferenceMatch } from "./reference-provider.ts";

// Verified against paired 2026 ONOSH, ONCMP/1/2, ARCHIMEDES and CMPTX fixtures.
// This is deliberately season/format gated. Other formats retain source identities.
export function firstPlayoffIdentity(
  match: ReferenceMatch,
  season: number,
  firstEventType: unknown,
  tbaPlayoffType: unknown,
): string | null {
  if (match.stage !== "playoff" || season !== 2026) return null;
  const doubleEliminationTypes = [
    "DistrictEvent",
    "DistrictChampionshipDivision",
    "ChampionshipDivision",
    "Championship",
  ];
  if (tbaPlayoffType === 10 && doubleEliminationTypes.includes(String(firstEventType))) {
    if (match.round === "sf" && match.set >= 1 && match.set <= 13 && match.number === 1)
      return `first:playoff:${match.set}`;
    if (match.round === "f" && match.set === 1 && match.number <= 3)
      return `first:playoff:${13 + match.number}`;
  }
  if (
    tbaPlayoffType === 9 &&
    firstEventType === "DistrictChampionshipWithLevels" &&
    match.round === "f" &&
    match.set === 1 &&
    match.number <= 3
  )
    return `first:playoff:${match.number}`;
  return null;
}
