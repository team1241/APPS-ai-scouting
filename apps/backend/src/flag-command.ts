export const flagUsage =
  "Use /flag <team-number> [match-number] [note]. Examples: /flag 1241, /flag 1241 42 climb was wrong, /flag 1241 P14 wrong team. Omit the match to flag your latest finalized submission for that team. Use -- before a note that starts with a number.";
export interface FlagRequest {
  teamNumber: number;
  matchLabel: string | null;
  note: string | null;
}
export function parseFlagRequest(argument: string): FlagRequest | null {
  const parts = /^(\d+)(?:\s+([\s\S]*))?$/.exec(argument.trim());
  if (!parts) return null;
  const teamNumber = Number(parts[1]);
  if (!Number.isSafeInteger(teamNumber) || teamNumber < 1 || teamNumber > 2147483647) return null;
  let remaining = parts[2]?.trim() ?? "";
  let matchLabel: string | null = null;
  if (remaining.startsWith("--")) remaining = remaining.slice(2).trim();
  else {
    const match = /^(Q|QM|P)?(\d+)(?:\s+|$)/i.exec(remaining);
    if (match) {
      const number = Number(match[2]);
      if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) return null;
      matchLabel = `${match[1]?.toUpperCase() === "P" ? "P" : "Q"}${number}`;
      remaining = remaining.slice(match[0].length).trim();
    } else if (/^(?:Q|QM|P)[\d-]/i.test(remaining)) return null;
  }
  if (remaining.length > 2000) return null;
  return { teamNumber, matchLabel, note: remaining || null };
}
export function matchLabelKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(?:qualification(?:\s+match)?|qm|q)\s*:?\s*([1-9]\d*)$/, "qm:$1")
    .replace(/^(?:playoff(?:\s+match)?|p)\s*:?\s*([1-9]\d*)$/, "first:playoff:$1");
}
