import { sql } from "kysely";
import {
  object,
  type ReferenceMatch,
  type ReferenceProvider,
  type ReferenceTeam,
} from "../reference-provider.ts";
import { memberInTransaction } from "./membership.ts";
import { persistReferenceSnapshot } from "./reference-cache.ts";
import { lockSchedulePoll, recordScheduleReceipt } from "./schedules.ts";
import { withTenant } from "./tenant.ts";

// The transaction lock spans fetch and persistence: another process cannot apply an older
// response after a newer one. Failed attempts commit status only, never partial data.
export function syncReference(
  organizationId: string,
  userId: string,
  eventId: string,
  provider: ReferenceProvider,
  minimumAgeMs = 0,
) {
  return withTenant(organizationId, async (tx) => {
    if ((await memberInTransaction(tx, organizationId, userId))?.role !== "admin")
      throw new Error("Admin required");
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${eventId}:${provider.source}`}, 17))`.execute(
      tx,
    );
    const event = await tx
      .selectFrom("event")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", eventId)
      .executeTakeFirstOrThrow();
    const code = provider.source === "frc_events" ? event.frc_event_code : event.tba_event_key;
    if (!code) throw new Error("Explicit provider event link required");
    const previous = await tx
      .selectFrom("reference_sync")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .where("source", "=", provider.source)
      .executeTakeFirst();
    if (previous && Date.now() - previous.attempted_at.getTime() < minimumAgeMs)
      return { status: "skipped" as const };
    const attempted = new Date();
    let snapshot: Awaited<ReturnType<ReferenceProvider["load"]>>;
    try {
      snapshot = await provider.load(event.season, code);
    } catch {
      await tx
        .insertInto("reference_sync")
        .values({
          organization_id: organizationId,
          event_id: eventId,
          source: provider.source,
          attempted_at: attempted,
          status: "failed",
          error: "Provider request or validation failed; cached data retained",
        })
        .onConflict((oc) =>
          oc.columns(["organization_id", "event_id", "source"]).doUpdateSet({
            attempted_at: attempted,
            status: "failed",
            error: "Provider request or validation failed; cached data retained",
          }),
        )
        .execute();
      return { status: "failed" as const };
    }
    await lockSchedulePoll(tx, organizationId, event.id);
    await persistReferenceSnapshot(tx, organizationId, event, provider.source, snapshot);
    if (snapshot.complete && snapshot.matches.length)
      await recordScheduleReceipt(tx, organizationId, event, provider.source, attempted);
    await tx
      .insertInto("reference_sync")
      .values({
        organization_id: organizationId,
        event_id: eventId,
        source: provider.source,
        attempted_at: attempted,
        succeeded_at: attempted,
        status: snapshot.complete ? "ok" : "partial",
        complete: snapshot.complete,
      })
      .onConflict((oc) =>
        oc.columns(["organization_id", "event_id", "source"]).doUpdateSet({
          attempted_at: attempted,
          succeeded_at: attempted,
          status: snapshot.complete ? "ok" : "partial",
          complete: snapshot.complete,
          error: null,
        }),
      )
      .execute();
    return {
      status: snapshot.complete ? ("ok" as const) : ("partial" as const),
      teams: snapshot.teams.length,
      matches: snapshot.matches.length,
    };
  });
}

// TBA keys must be supplied deliberately. No FIRST-code case conversion or guessing.
export function linkTbaEvent(organizationId: string, userId: string, eventId: string, key: string) {
  return withTenant(organizationId, async (tx) => {
    if ((await memberInTransaction(tx, organizationId, userId))?.role !== "admin")
      throw new Error("Admin required");
    const event = await tx
      .selectFrom("event")
      .select("season")
      .where("organization_id", "=", organizationId)
      .where("id", "=", eventId)
      .executeTakeFirstOrThrow();
    if (!new RegExp(`^${event.season}[a-z0-9]+$`).test(key)) throw new Error("Invalid TBA key");
    const previous = await tx
      .selectFrom("event")
      .select("tba_event_key")
      .where("organization_id", "=", organizationId)
      .where("id", "=", eventId)
      .executeTakeFirstOrThrow();
    if (previous.tba_event_key && previous.tba_event_key !== key)
      throw new Error("Provider relinking requires reconciliation of cached data");
    await tx
      .updateTable("event")
      .set({ tba_event_key: key })
      .where("organization_id", "=", organizationId)
      .where("id", "=", eventId)
      .execute();
  });
}
export function resolveFacts(facts: unknown, manual: unknown): Record<string, unknown> {
  const f = object(facts);
  // Null primary fields can be supplemented; manual nulls deliberately clear fields.
  return {
    ...object(f.tba ?? {}),
    ...Object.fromEntries(Object.entries(object(f.frc_events ?? {})).filter(([, v]) => v != null)),
    ...object(manual),
    provenance: Object.keys(f),
  };
}
export function readReference(organizationId: string, userId: string, eventId: string) {
  return withTenant(organizationId, async (tx) => {
    if (!(await memberInTransaction(tx, organizationId, userId)))
      throw new Error("Membership required");
    const teams = await tx
      .selectFrom("event_team")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .orderBy("team_number")
      .execute();
    const matches = await tx
      .selectFrom("event_match")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .orderBy("identity")
      .execute();
    const sync = await tx
      .selectFrom("reference_sync")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .execute();
    const schedulePoll = await tx
      .selectFrom("schedule_poll")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .executeTakeFirst();
    const scheduleNotifications = await tx
      .selectFrom("schedule_notification")
      .select("status")
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .execute();
    return {
      schedulePoll,
      scheduleNotifications,
      scheduleState: schedulePoll?.received_at
        ? "saved"
        : matches.length === 0
          ? "absent"
          : sync.some(
                (s) =>
                  s.succeeded_at &&
                  s.status !== "failed" &&
                  Date.now() - s.succeeded_at.getTime() <= 300_000,
              )
            ? "fresh"
            : "stale",
      teams: teams.map(
        (t) =>
          ({ id: t.id, ...resolveFacts(t.facts, t.manual_override) }) as ReferenceTeam & {
            id: string;
          },
      ),
      matches: matches.map(
        (m) =>
          ({ id: m.id, ...resolveFacts(m.facts, m.manual_override) }) as ReferenceMatch & {
            id: string;
          },
      ),
      sync: sync.map((s) => ({
        ...s,
        freshness: !s.succeeded_at
          ? "absent"
          : s.status === "failed" || Date.now() - s.succeeded_at.getTime() > 300_000
            ? "stale"
            : "fresh",
      })),
    };
  });
}
export function overrideReference(
  organizationId: string,
  userId: string,
  eventId: string,
  kind: "team" | "match",
  id: string,
  fields: Record<string, unknown>,
) {
  const allowed =
    kind === "team"
      ? ["name", "city", "region", "country"]
      : ["scheduled", "predicted", "actual", "completed"];
  if (
    Object.entries(fields).some(
      ([k, v]) => !allowed.includes(k) || (v !== null && typeof v !== "string"),
    )
  )
    throw new Error("Unsupported override");
  return withTenant(organizationId, async (tx) => {
    if ((await memberInTransaction(tx, organizationId, userId))?.role !== "admin")
      throw new Error("Admin required");
    return tx
      .updateTable(kind === "team" ? "event_team" : "event_match")
      .set({ manual_override: JSON.stringify(fields) })
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirstOrThrow();
  });
}

export function importTbaEvent(
  organizationId: string,
  userId: string,
  config: import("../event-config.ts").EventConfig,
) {
  return withTenant(organizationId, async (tx) => {
    if ((await memberInTransaction(tx, organizationId, userId))?.role !== "admin")
      throw new Error("Admin required");
    if (config.source !== "tba" || !config.tbaEventKey) throw new Error("TBA event required");
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${organizationId}:tba:${config.tbaEventKey}`}, 17))`.execute(
      tx,
    );
    const existing = await tx
      .selectFrom("event")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("tba_event_key", "=", config.tbaEventKey)
      .execute();
    if (existing.length > 1) throw new Error("Ambiguous TBA event link");
    if (existing[0]) return existing[0].id;
    const row = await tx
      .insertInto("event")
      .values({
        organization_id: organizationId,
        name: config.name,
        season: config.season,
        type: config.type,
        source: "tba",
        tba_event_key: config.tbaEventKey,
        timezone: config.timezone,
        start_date: config.startDate,
        end_date: config.endDate,
        specification_version: config.specificationVersion,
        validation_mode: config.validationMode,
        attending: config.attending,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  });
}
