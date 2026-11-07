import { requirements } from "@ai-scouting/scouting";
import { sql, type Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import { type EventConfig, parseEventConfig } from "../event-config.ts";
import { discoverTbaEventKey } from "../tba-event-link.ts";
import { memberInTransaction } from "./membership.ts";
import { scheduleInTransaction } from "./participation.ts";
import { withTenant } from "./tenant.ts";

// Share this lock with intake so activation and event assignment have a definite order.
export async function lockEventContext(tx: Transaction<DB>, organizationId: string) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 9))`.execute(tx);
}
export async function activeEvent(tx: Transaction<DB>, organizationId: string) {
  return tx
    .selectFrom("organization_event_setting")
    .innerJoin("event", (join) =>
      join
        .onRef("event.id", "=", "organization_event_setting.active_event_id")
        .onRef("event.organization_id", "=", "organization_event_setting.organization_id"),
    )
    .selectAll("event")
    .where("event.organization_id", "=", organizationId)
    .executeTakeFirst();
}
export function readEvents(organizationId: string, userId: string) {
  return withTenant(organizationId, async (tx) => {
    const member = await memberInTransaction(tx, organizationId, userId);
    if (!member) return null;
    const active = await activeEvent(tx, organizationId);
    const sessions = await tx
      .selectFrom("scouting_session")
      .innerJoin("event", "event.id", "scouting_session.event_id")
      .select([
        "scouting_session.id",
        "event.name",
        "scouting_session.event_id",
        "scouting_session.match_label",
        "scouting_session.team_number",
        "scouting_session.validation_result",
      ])
      .where("scouting_session.organization_id", "=", organizationId)
      .where("event.organization_id", "=", organizationId)
      .where("scouting_session.member_id", "=", member.id)
      .where("scouting_session.status", "=", "collecting")
      .orderBy("scouting_session.created_at", "desc")
      .limit(5)
      .execute();
    return {
      active,
      schedule: active ? await scheduleInTransaction(tx, organizationId, active.id) : null,
      sessions,
      events: await tx
        .selectFrom("event")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .orderBy("start_date", "desc")
        .orderBy("id")
        .limit(20)
        .execute(),
    };
  });
}
export type EventAction =
  | { kind: "activate-frc" | "import-frc" | "refresh-frc"; config: EventConfig }
  | { kind: "activate"; eventId: string | null }
  | { kind: "validation"; eventId: string; mode: "off" | "warn" | "strict" }
  | { kind: "archive" | "restore"; eventId: string };
interface MutationResult {
  status: "ok" | "forbidden" | "missing" | "active_event" | "unsupported" | "ambiguous";
  eventId?: string;
  eventName?: string;
  tbaEventKey?: string | null;
}
export function changeEvent(
  organizationId: string,
  userId: string,
  updateId: string,
  action: EventAction,
  discoverTba: typeof discoverTbaEventKey = discoverTbaEventKey,
): Promise<MutationResult> {
  return withTenant(organizationId, async (tx) => {
    const member = await memberInTransaction(tx, organizationId, userId);
    if (member?.role !== "admin") return { status: "forbidden" };
    await lockEventContext(tx, organizationId);
    const previous = await tx
      .selectFrom("event_command")
      .select("result")
      .where("organization_id", "=", organizationId)
      .where("source_update_id", "=", updateId)
      .executeTakeFirst();
    if (previous) return previous.result as unknown as MutationResult;
    const result = await mutate(tx, organizationId, action, discoverTba);
    await tx
      .insertInto("event_command")
      .values({
        organization_id: organizationId,
        source_update_id: updateId,
        result: JSON.stringify(result),
      })
      .execute();
    return result;
  });
}
async function mutate(
  tx: Transaction<DB>,
  organizationId: string,
  action: EventAction,
  discoverTba: typeof discoverTbaEventKey = discoverTbaEventKey,
): Promise<MutationResult> {
  if (
    action.kind === "activate-frc" ||
    action.kind === "import-frc" ||
    action.kind === "refresh-frc"
  ) {
    const c = parseEventConfig(action.config);
    if (c.source !== "frc_events" || !c.frcEventCode) return { status: "unsupported" };
    const matches = await tx
      .selectFrom("event")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("season", "=", c.season)
      .where(sql<boolean>`upper(frc_event_code) = ${c.frcEventCode.toUpperCase()}`)
      .limit(2)
      .execute();
    if (matches.length > 1) return { status: "ambiguous" };
    const existing = matches[0];
    if (action.kind === "refresh-frc" && !existing) return { status: "missing" };
    if (existing?.archived && action.kind !== "refresh-frc") return { status: "missing" };
    let tbaKey = existing?.tba_event_key ?? c.tbaEventKey;
    if (!tbaKey && (!existing || action.kind === "refresh-frc")) {
      tbaKey = await discoverTba(c);
      if (tbaKey) {
        const linked = await tx
          .selectFrom("event")
          .select("id")
          .where("organization_id", "=", organizationId)
          .where("tba_event_key", "=", tbaKey)
          .executeTakeFirst();
        if (linked && linked.id !== existing?.id) tbaKey = null;
      }
    }
    const metadata = {
      name: c.name,
      type: c.type,
      source: c.source,
      start_date: c.startDate,
      end_date: c.endDate,
      timezone: c.timezone,
      frc_event_code: c.frcEventCode,
      tba_event_key: tbaKey,
    };
    let eventId = existing?.id;
    let eventName = existing?.name ?? c.name;
    if (!existing) {
      const created = await tx
        .insertInto("event")
        .values({
          organization_id: organizationId,
          season: c.season,
          ...metadata,
          attending: c.attending,
          specification_version: c.specificationVersion,
          validation_mode: c.validationMode,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      eventId = created.id;
    } else if (action.kind === "refresh-frc" || existing.source !== "frc_events") {
      // Provider facts refresh together; organization settings and session links stay pinned.
      await tx
        .updateTable("event")
        .set(metadata)
        .where("organization_id", "=", organizationId)
        .where("id", "=", existing.id)
        .execute();
      eventName = c.name;
    }
    if (!eventId) return { status: "missing" };
    if (action.kind === "activate-frc")
      return {
        ...(await mutate(tx, organizationId, { kind: "activate", eventId })),
        eventName,
        tbaEventKey: tbaKey,
      };
    return { status: "ok", eventId, eventName, tbaEventKey: tbaKey };
  }
  if (!("eventId" in action)) return { status: "unsupported" };
  const event = action.eventId
    ? await tx
        .selectFrom("event")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("id", "=", action.eventId)
        .executeTakeFirst()
    : null;
  if (action.eventId && !event) return { status: "missing" };
  if (action.kind === "activate") {
    if (event?.archived) return { status: "missing" };
    if (event && event.specification_version !== requirements.version)
      return { status: "unsupported" };
    await tx
      .insertInto("organization_event_setting")
      .values({ organization_id: organizationId, active_event_id: action.eventId })
      .onConflict((oc) =>
        oc.column("organization_id").doUpdateSet({ active_event_id: action.eventId }),
      )
      .execute();
    return { status: "ok", ...(event ? { eventId: event.id, eventName: event.name } : {}) };
  }
  if (!event) return { status: "missing" };
  if (action.kind === "validation") {
    await tx
      .updateTable("event")
      .set({ validation_mode: action.mode })
      .where("organization_id", "=", organizationId)
      .where("id", "=", event.id)
      .execute();
    return { status: "ok", eventId: event.id };
  }
  if (action.kind === "archive" || action.kind === "restore") {
    if (action.kind === "archive" && (await activeEvent(tx, organizationId))?.id === event.id)
      return { status: "active_event" };
    await tx
      .updateTable("event")
      .set({ archived: action.kind === "archive" })
      .where("organization_id", "=", organizationId)
      .where("id", "=", event.id)
      .execute();
    return { status: "ok", eventId: event.id };
  }
  return { status: "missing" };
}

export function findFrcEvent(organizationId: string, userId: string, season: number, code: string) {
  return withTenant(organizationId, async (tx) => {
    if ((await memberInTransaction(tx, organizationId, userId))?.role !== "admin")
      return { status: "forbidden" } as const;
    const events = await tx
      .selectFrom("event")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("season", "=", season)
      .where(sql<boolean>`upper(frc_event_code) = ${code.toUpperCase()}`)
      .limit(2)
      .execute();
    if (events.length > 1) return { status: "ambiguous" } as const;
    return { status: "ok", event: events[0] } as const;
  });
}
