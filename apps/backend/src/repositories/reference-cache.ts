import { type Selectable, sql, type Transaction } from "kysely";
import type { DB, Event } from "../db.generated.ts";
import { firstPlayoffIdentity } from "../playoff-identity.ts";
import { object, type Snapshot, type Source } from "../reference-provider.ts";

export async function persistReferenceSnapshot(
  tx: Transaction<DB>,
  organizationId: string,
  event: Selectable<Event>,
  source: Source,
  snapshot: Snapshot,
) {
  const eventId = event.id;
  const eventFacts = object(event.provider_facts);
  const primaryFacts = object(eventFacts.frc_events ?? {});
  if (snapshot.eventFacts)
    await tx
      .updateTable("event")
      .set({
        provider_facts: sql`provider_facts || ${JSON.stringify({ [source]: snapshot.eventFacts })}::jsonb`,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", eventId)
      .execute();
  for (const team of snapshot.teams) {
    await tx
      .insertInto("event_team")
      .values({
        organization_id: organizationId,
        event_id: eventId,
        team_number: team.number,
        facts: JSON.stringify({ [source]: team }),
      })
      .onConflict((oc) =>
        oc.columns(["organization_id", "event_id", "team_number"]).doUpdateSet({
          facts: sql`event_team.facts || ${JSON.stringify({ [source]: team })}::jsonb`,
        }),
      )
      .execute();
  }
  for (const match of snapshot.matches) {
    const identity =
      source === "tba" && event.frc_event_code
        ? (firstPlayoffIdentity(
            match,
            event.season,
            primaryFacts.type,
            snapshot.eventFacts?.playoff_type,
          ) ?? match.key)
        : match.key;
    const row = await tx
      .insertInto("event_match")
      .values({
        organization_id: organizationId,
        event_id: eventId,
        identity,
        stage: match.stage,
        round: match.round,
        set_number: match.set,
        match_number: match.number,
        facts: JSON.stringify({ [source]: match }),
      })
      .onConflict((oc) =>
        oc.columns(["organization_id", "event_id", "identity"]).doUpdateSet({
          facts: sql`jsonb_set(event_match.facts, ARRAY[${source}]::text[], coalesce(event_match.facts -> ${source}, '{}'::jsonb) || jsonb_strip_nulls(${JSON.stringify(match)}::jsonb))`,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .deleteFrom("match_participant")
      .where("organization_id", "=", organizationId)
      .where("match_id", "=", row.id)
      .where("source", "=", source)
      .execute();
    for (const p of match.participants)
      await tx
        .insertInto("match_participant")
        .values({
          organization_id: organizationId,
          match_id: row.id,
          source: source,
          station: p.station,
          team_number: p.number,
          surrogate: p.surrogate,
        })
        .execute();
  }
}
