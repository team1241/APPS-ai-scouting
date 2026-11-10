import type { Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import {
  type ParticipationValidation,
  type ScheduledMatch,
  scheduleState,
  type ValidationMode,
  validateParticipation,
} from "../participation.ts";
import { object } from "../reference-provider.ts";

export async function scheduleInTransaction(
  tx: Transaction<DB>,
  organizationId: string,
  eventId: string,
) {
  const rows = await tx
    .selectFrom("event_match")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("event_id", "=", eventId)
    .execute();
  const participants = await tx
    .selectFrom("match_participant")
    .innerJoin("event_match", "event_match.id", "match_participant.match_id")
    .selectAll("match_participant")
    .where("event_match.organization_id", "=", organizationId)
    .where("match_participant.organization_id", "=", organizationId)
    .where("event_match.event_id", "=", eventId)
    .execute();
  const receipt = await tx
    .selectFrom("schedule_poll")
    .select("received_at")
    .where("organization_id", "=", organizationId)
    .where("event_id", "=", eventId)
    .executeTakeFirst();
  const sync = await tx
    .selectFrom("reference_sync")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("event_id", "=", eventId)
    .execute();
  const matches: ScheduledMatch[] = rows.map((row) => {
    const facts = object(row.facts);
    const aliases = Object.values(facts).flatMap((f) => {
      const key = object(f).key;
      if (typeof key !== "string") return [];
      // TBA stores event-prefixed keys; its explicit local suffix is also useful to scouts.
      return [key, key.slice(key.lastIndexOf("_") + 1)];
    });
    const source = facts.frc_events ? "frc_events" : "tba";
    const stored = participants
      .filter((p) => p.match_id === row.id && p.source === source)
      .map((p) => ({ number: p.team_number, station: p.station, surrogate: p.surrogate }));
    return {
      id: row.id,
      identity: row.identity,
      aliases,
      participants: stored,
    };
  });
  return {
    state: scheduleState(receipt?.received_at, rows.length, sync),
    receivedAt: receipt?.received_at ?? null,
    matches,
  };
}

export async function validateSessionInTransaction(
  tx: Transaction<DB>,
  organizationId: string,
  sessionId: string,
  values: Record<string, unknown>,
) {
  const session = await tx
    .selectFrom("scouting_session")
    .innerJoin("event", "event.id", "scouting_session.event_id")
    .select([
      "scouting_session.member_id",
      "scouting_session.created_at",
      "scouting_session.validation_result",
      "scouting_session.event_id",
      "scouting_session.kind",
      "event.validation_mode",
    ])
    .where("scouting_session.organization_id", "=", organizationId)
    .where("event.organization_id", "=", organizationId)
    .where("scouting_session.id", "=", sessionId)
    .executeTakeFirstOrThrow();
  const mode: ValidationMode =
    session.validation_mode === "off" || session.validation_mode === "strict"
      ? session.validation_mode
      : "warn";
  if (session.kind !== "match") {
    const validation: ParticipationValidation = {
      mode,
      status: "not_applicable",
      message: null,
      matchId: null,
    };
    return { session, validation };
  }
  const schedule = await scheduleInTransaction(tx, organizationId, session.event_id as string);
  const validation = validateParticipation(
    mode,
    schedule.state,
    schedule.matches,
    values.match,
    values.team_number,
  );
  if (mode === "off")
    validation.matchId = validateParticipation(
      "warn",
      schedule.state,
      schedule.matches,
      values.match,
      values.team_number,
    ).matchId;
  return { session, validation };
}
