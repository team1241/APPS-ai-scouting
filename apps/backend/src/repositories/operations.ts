import { sql } from "kysely";
import { memberInTransaction } from "./membership.ts";
import { withTenant } from "./tenant.ts";
export function workerEvents(org: string) {
  return withTenant(org, (tx) =>
    tx
      .selectFrom("event")
      .select(["start_date", "end_date", "timezone", "attending", "archived"])
      .where("organization_id", "=", org)
      .where("archived", "=", false)
      .where("attending", "=", true)
      .execute(),
  );
}
export function operationSnapshot(org: string, user: string, now = new Date()) {
  return withTenant(org, async (tx) => {
    if ((await memberInTransaction(tx, org, user))?.role !== "admin") throw Error("Admin required");
    const outbound = await tx
      .selectFrom("outbound_delivery")
      .select([
        "status",
        sql<number>`count(*)::int`.as("count"),
        sql<number>`sum(attempts)::int`.as("attempts"),
        sql<number>`count(*) filter (where next_attempt_at <= ${now} and status='pending')::int`.as(
          "due",
        ),
        sql<number>`count(*) filter (where status='sending' and lease_expires_at <= ${now})::int`.as(
          "staleLeases",
        ),
        sql<Date | null>`min(created_at) filter (where status='pending')`.as("oldestQueuedAt"),
        sql<Date | null>`min(next_attempt_at) filter (where status='pending' and next_attempt_at <= ${now})`.as(
          "oldestDueAt",
        ),
        sql<
          number | null
        >`(max(extract(epoch from (sent_at-created_at))*1000) filter (where sent_at is not null))::double precision`.as(
          "maxDeliveryLatencyMs",
        ),
      ])
      .where("organization_id", "=", org)
      .groupBy("status")
      .execute();
    const extraction = await tx
      .selectFrom("raw_entry")
      .select([
        "status",
        sql<number>`count(*)::int`.as("count"),
        sql<number>`count(*) filter (where processing_attempts >= 3 and status in ('failed','processing'))::int`.as(
          "exhausted",
        ),
        sql<number>`count(*) filter (where status='processing' and processing_started_at <= ${new Date(now.getTime() - 300000)})::int`.as(
          "staleLeases",
        ),
        sql<Date | null>`min(received_at) filter (where status in ('pending','failed','processing'))`.as(
          "oldestQueuedAt",
        ),
        sql<number>`sum(processing_attempts)::int`.as("attempts"),
      ])
      .where("organization_id", "=", org)
      .where("parent_entry_id", "is", null)
      .groupBy("status")
      .execute();
    const schedules = await tx
      .selectFrom("schedule_poll")
      .select([
        "status",
        sql<number>`count(*)::int`.as("count"),
        sql<Date | null>`max(attempted_at)`.as("lastAttemptAt"),
        sql<Date | null>`max(received_at)`.as("lastReceivedAt"),
      ])
      .where("organization_id", "=", org)
      .groupBy("status")
      .execute();
    return { measuredAt: now.toISOString(), outbound, extraction, schedules };
  });
}

// Restoring a snapshot rewinds the delivery ledger but cannot rewind Telegram.
// Quarantine before enabling workers; operators must reconcile these rows explicitly.
export function quarantineRestoredDeliveries(org: string, user: string, reason: string) {
  if (!reason.trim() || reason.length > 500) throw Error("Provide a reason of 1–500 characters");
  return withTenant(org, async (tx) => {
    const actor = await memberInTransaction(tx, org, user);
    if (actor?.role !== "admin") throw Error("Admin required");
    const rows = await tx
      .selectFrom("outbound_delivery")
      .select(["id", "status"])
      .where("organization_id", "=", org)
      .where("status", "in", ["pending", "sending"])
      .forUpdate()
      .execute();
    for (const row of rows) {
      await tx
        .insertInto("outbound_intervention")
        .values({
          organization_id: org,
          delivery_id: row.id,
          actor_id: actor.id,
          reason,
          previous_status: row.status,
          accepted_duplicate_risk: false,
        })
        .execute();
      await tx
        .updateTable("outbound_delivery")
        .set({
          status: "ambiguous",
          error: "Restored ledger; Telegram acceptance must be reconciled",
          lease_token: null,
          lease_expires_at: null,
          updated_at: new Date(),
          operator_at: new Date(),
          operator_id: actor.id,
          operator_reason: reason,
        })
        .where("organization_id", "=", org)
        .where("id", "=", row.id)
        .execute();
    }
    return { quarantined: rows.length };
  });
}
