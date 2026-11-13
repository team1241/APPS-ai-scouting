import type { Participant } from "./reference-provider.ts";

export type ValidationMode = "off" | "warn" | "strict";
export type ScheduleState = "saved" | "absent" | "stale";
export interface ScheduledMatch {
  id: string;
  identity: string;
  aliases: string[];
  participants: Participant[];
}
export interface ParticipationValidation {
  mode: ValidationMode;
  status:
    | "off"
    | "valid"
    | "missing_identity"
    | "missing_schedule"
    | "stale_schedule"
    | "ambiguous_match"
    | "unknown_match"
    | "invalid_pairing"
    | "incomplete_participants"
    // A pit note names a team that is not on the event's roster.
    | "unknown_team"
    // Pit and general observations are not checked against the match schedule.
    | "not_applicable";
  matchId: string | null;
  message: string | null;
}

// Schedule acquisition is one-time. Wall-clock age alone cannot invalidate that snapshot.
export function scheduleState(
  receivedAt: Date | null | undefined,
  matches: number,
  sync: { status: string; attempted_at: Date; succeeded_at: Date | null }[],
): ScheduleState {
  if (!matches) return "absent";
  if (!receivedAt) return "stale";
  return sync.some((s) => s.attempted_at >= receivedAt && s.status !== "ok") ? "stale" : "saved";
}

function labelKey(label: string): string {
  const value = label.trim().toLowerCase();
  const qualification = /^(?:q|qm|qualification(?:\s+match)?)\s*:?\s*([1-9]\d*)$/.exec(value);
  if (qualification) return `qm:${qualification[1]}`;
  const playoff = /^(?:p|playoff(?:\s+match)?)\s*:?\s*([1-9]\d*)$/.exec(value);
  if (playoff) return `first:playoff:${playoff[1]}`;
  return value;
}

export function validateParticipation(
  mode: ValidationMode,
  state: ScheduleState,
  matches: ScheduledMatch[],
  label: unknown,
  team: unknown,
): ParticipationValidation {
  const result = (
    status: ParticipationValidation["status"],
    message: string | null,
    matchId: string | null = null,
  ): ParticipationValidation => ({ mode, status, message, matchId });
  if (mode === "off") return result("off", null);
  if (typeof label !== "string" || !label.trim() || !Number.isSafeInteger(team) || Number(team) < 1)
    return result("missing_identity", "Please tell me the match and team number for this note.");
  if (state === "absent")
    return result(
      "missing_schedule",
      "This event doesn't have a match schedule yet, so I can't check the match and team.\nDouble-check them, or ask an admin to sync the schedule.",
    );
  if (state === "stale")
    return result(
      "stale_schedule",
      "The saved schedule for this event may be out of date, so I can't confirm the match and team.\nDouble-check them, or ask an admin to sync the schedule.",
    );
  const key = labelKey(label);
  // Bare numbers and round-only labels never imply a stage, set or replay.
  if (/^\d+$/.test(key) || /^(?:final|semifinal|quarterfinal|f|sf|qf)\s*\d*$/i.test(key))
    return result(
      "ambiguous_match",
      "Which match is this? Use Q and a number for qualification matches (like Q12), or P and a number for playoff matches (like P3).",
    );
  const candidates = matches.filter((m) =>
    [m.identity, ...m.aliases].some((a) => labelKey(a) === key),
  );
  if (candidates.length > 1)
    return result(
      "ambiguous_match",
      "That could be more than one match. Please use the exact match key, like sf1m1.",
    );
  const match = candidates[0];
  if (!match)
    return result(
      "unknown_match",
      `${label} isn't in this event's schedule. Please check the match number.\nFor a playoff match, an admin may need to sync the schedule first.`,
    );
  const participants = match.participants;
  if (
    participants.length !== 6 ||
    new Set(participants.map((p) => p.station)).size !== 6 ||
    new Set(participants.map((p) => p.number)).size !== 6 ||
    participants.some((p) => !/^(Red|Blue)[123]$/.test(p.station))
  )
    return result(
      "incomplete_participants",
      "The schedule for this match is incomplete, so I can't check the team. Ask an admin to sync the schedule.",
    );
  if (!participants.some((p) => p.number === team))
    return result(
      "invalid_pairing",
      `Team ${team} isn't scheduled to play in ${label}. Please check the match and team number.`,
      match.id,
    );
  return result("valid", null, match.id);
}
