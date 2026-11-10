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
    return result(
      "missing_identity",
      "Please specify the match label and team number for this event.",
    );
  if (state === "absent")
    return result(
      "missing_schedule",
      "No schedule is saved for this event. Confirm the event, match and team; ask an admin to acquire or explicitly sync its schedule.",
    );
  if (state === "stale")
    return result(
      "stale_schedule",
      "The cached schedule is unverified or a later import was incomplete/failed. Confirm the event, match and team; ask an admin to explicitly sync the schedule.",
    );
  const key = labelKey(label);
  // Bare numbers and round-only labels never imply a stage, set or replay.
  if (/^\d+$/.test(key) || /^(?:final|semifinal|quarterfinal|f|sf|qf)\s*\d*$/i.test(key))
    return result(
      "ambiguous_match",
      "Please use Q<number>, P<FIRST playoff number>, or an exact stored match key (for example sf1m1). Round/set details are required for playoffs.",
    );
  const candidates = matches.filter((m) =>
    [m.identity, ...m.aliases].some((a) => labelKey(a) === key),
  );
  if (candidates.length > 1)
    return result(
      "ambiguous_match",
      "That label identifies multiple stored matches. Please provide the exact stored match key and event.",
    );
  const match = candidates[0];
  if (!match)
    return result(
      "unknown_match",
      "That match is absent from this event's saved schedule. Check its exact label and event; later playoff schedules require an explicit admin sync.",
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
      "This match has incomplete or conflicting participants. Ask an admin to explicitly sync its schedule.",
    );
  if (!participants.some((p) => p.number === team))
    return result(
      "invalid_pairing",
      `Team ${team} is not scheduled in ${label} for this event. Please check the match, team and event.`,
      match.id,
    );
  return result("valid", null, match.id);
}
