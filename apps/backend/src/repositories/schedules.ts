import { randomUUID } from "node:crypto";
import { type Selectable, sql, type Transaction } from "kysely";
import type { DB, Event } from "../db.generated.ts";
import { object, type Snapshot, type Source } from "../reference-provider.ts";
import { schedulePollInterval, schedulePollingStarted } from "../schedule-policy.ts";
import { persistReferenceSnapshot } from "./reference-cache.ts";
import { withTenant } from "./tenant.ts";

export async function lockSchedulePoll(
  tx: Transaction<DB>,
  organizationId: string,
  eventId: string,
) {
  await tx
    .insertInto("schedule_poll")
    .values({ organization_id: organizationId, event_id: eventId })
    .onConflict((oc) => oc.columns(["organization_id", "event_id"]).doNothing())
    .execute();
  return tx
    .selectFrom("schedule_poll")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("event_id", "=", eventId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

// Receipt and recipient snapshots commit in the same transaction as the schedule.
export async function recordScheduleReceipt(
  tx: Transaction<DB>,
  organizationId: string,
  event: Selectable<Event>,
  source: Source,
  now: Date,
) {
  await lockSchedulePoll(tx, organizationId, event.id);
  const changed = await tx
    .updateTable("schedule_poll")
    .set({ received_at: now, status: "received", source, error: null })
    .where("organization_id", "=", organizationId)
    .where("event_id", "=", event.id)
    .where("received_at", "is", null)
    .returning("event_id")
    .executeTakeFirst();
  if (!changed) return;
  const admins = await tx
    .selectFrom("channel_identity as identity")
    .innerJoin("member as admin", (join) =>
      join
        .onRef("admin.id", "=", "identity.member_id")
        .onRef("admin.organization_id", "=", "identity.organization_id"),
    )
    .select("identity.external_id")
    .where("identity.organization_id", "=", organizationId)
    .where("identity.channel", "=", "telegram")
    .where("admin.role", "=", "admin")
    .execute();
  for (const admin of admins)
    await tx
      .insertInto("schedule_notification")
      .values({
        organization_id: organizationId,
        event_id: event.id,
        telegram_user_id: admin.external_id,
        text: `The match schedule for ${event.name} (${event.season}${event.frc_event_code ? ` ${event.frc_event_code}` : ""}) has been received and saved. Automatic schedule polling has stopped.`,
        next_attempt_at: now,
      })
      .onConflict((oc) =>
        oc.columns(["organization_id", "event_id", "telegram_user_id"]).doNothing(),
      )
      .execute();
}

// Background operations are tenant-scoped and invoked only by the configured cron process.
export function scheduleCandidates(organizationId: string) {
  return withTenant(organizationId, (tx) =>
    tx
      .selectFrom("event as e")
      .leftJoin("schedule_poll as p", (join) =>
        join.onRef("p.event_id", "=", "e.id").onRef("p.organization_id", "=", "e.organization_id"),
      )
      .selectAll("e")
      .where("e.organization_id", "=", organizationId)
      .where("e.archived", "=", false)
      .where("p.received_at", "is", null)
      .orderBy("e.start_date")
      .execute(),
  );
}
export function claimSchedulePoll(organizationId: string, eventId: string, now: Date) {
  return withTenant(organizationId, async (tx) => {
    const event = await tx
      .selectFrom("event")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", eventId)
      .executeTakeFirstOrThrow();
    if (!schedulePollingStarted(event, now)) return null;
    const poll = await lockSchedulePoll(tx, organizationId, eventId);
    if (poll.received_at) return null;
    if (!event.frc_event_code && !event.tba_event_key) return null;
    if (poll.attempted_at && now.getTime() - poll.attempted_at.getTime() < schedulePollInterval)
      return null;
    const attemptId = randomUUID();
    await tx
      .updateTable("schedule_poll")
      .set({ attempt_id: attemptId, attempted_at: now, status: "fetching", error: null })
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .execute();
    return { event, attemptId };
  });
}
export function finishSchedulePoll(
  organizationId: string,
  eventId: string,
  attemptId: string,
  snapshots: { source: Source; snapshot: Snapshot }[],
  failed: boolean,
  now: Date,
) {
  return withTenant(organizationId, async (tx) => {
    const poll = await lockSchedulePoll(tx, organizationId, eventId);
    if (poll.received_at || poll.attempt_id !== attemptId) return false;
    const event = await tx
      .selectFrom("event")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", eventId)
      .executeTakeFirstOrThrow();
    if (event.archived) {
      await tx
        .updateTable("schedule_poll")
        .set({ status: "waiting" })
        .where("organization_id", "=", organizationId)
        .where("event_id", "=", eventId)
        .execute();
      return false;
    }
    let received: Source | null = null;
    for (const { source, snapshot } of snapshots) {
      if (snapshot.eventFacts) {
        await tx
          .updateTable("event")
          .set({
            provider_facts: sql`provider_facts || ${JSON.stringify({ [source]: snapshot.eventFacts })}::jsonb`,
          })
          .where("organization_id", "=", organizationId)
          .where("id", "=", eventId)
          .execute();
        event.provider_facts = {
          ...object(event.provider_facts),
          [source]: snapshot.eventFacts,
        } as typeof event.provider_facts;
      }
      if (!snapshot.complete || !snapshot.matches.length) continue;
      await persistReferenceSnapshot(tx, organizationId, event, source, snapshot);
      received = source;
      break;
    }
    if (received) {
      await recordScheduleReceipt(tx, organizationId, event, received, now);
      return true;
    }
    await tx
      .updateTable("schedule_poll")
      .set({
        status: failed ? "failed" : "waiting",
        error: failed ? "Schedule provider failed; will retry" : "Schedule not published yet",
      })
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .execute();
    return false;
  });
}

export function claimScheduleNotification(organizationId: string, now: Date) {
  return withTenant(organizationId, async (tx) => {
    // A crash after sending has an unknown outcome. Never silently resend it.
    await tx
      .updateTable("schedule_notification")
      .set({ status: "uncertain", error: "Delivery interrupted; review before retrying" })
      .where("organization_id", "=", organizationId)
      .where("status", "=", "sending")
      .where("attempted_at", "<", new Date(now.getTime() - 5 * 60_000))
      .execute();
    await tx
      .updateTable("schedule_notification")
      .set({ status: "cancelled" })
      .where("organization_id", "=", organizationId)
      .where("status", "=", "pending")
      .where(
        sql<boolean>`not exists (select 1 from channel_identity i join member m on m.organization_id=i.organization_id and m.id=i.member_id where i.organization_id=schedule_notification.organization_id and i.external_id=schedule_notification.telegram_user_id and i.channel='telegram' and m.role='admin')`,
      )
      .execute();
    const row = await tx
      .selectFrom("schedule_notification")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("status", "=", "pending")
      .where("next_attempt_at", "<=", now)
      .orderBy("next_attempt_at")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!row) return null;
    const attemptId = randomUUID();
    await tx
      .updateTable("schedule_notification")
      .set({ status: "sending", attempt_id: attemptId, attempted_at: now })
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", row.event_id)
      .where("telegram_user_id", "=", row.telegram_user_id)
      .execute();
    return { ...row, attempt_id: attemptId };
  });
}
export function finishScheduleNotification(
  organizationId: string,
  eventId: string,
  userId: string,
  attemptId: string,
  outcome: { status: "sent" | "pending" | "failed" | "uncertain"; retryAfterMs?: number },
  now: Date,
) {
  return withTenant(organizationId, (tx) =>
    tx
      .updateTable("schedule_notification")
      .set({
        status: outcome.status,
        sent_at: outcome.status === "sent" ? now : null,
        next_attempt_at: new Date(now.getTime() + (outcome.retryAfterMs ?? schedulePollInterval)),
        error:
          outcome.status === "sent"
            ? null
            : outcome.status === "uncertain"
              ? "Telegram delivery outcome unknown; review before retrying"
              : "Telegram delivery rejected",
      })
      .where("organization_id", "=", organizationId)
      .where("event_id", "=", eventId)
      .where("telegram_user_id", "=", userId)
      .where("attempt_id", "=", attemptId)
      .where("status", "=", "sending")
      .execute(),
  );
}
