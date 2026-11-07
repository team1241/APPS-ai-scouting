import { randomUUID } from "node:crypto";
import type { Insertable, Transaction } from "kysely";
import type { DB, OutboundDelivery } from "../db.generated.ts";
import { memberInTransaction } from "./membership.ts";
import { withTenant } from "./tenant.ts";

export async function enqueueDelivery(tx: Transaction<DB>, delivery: Insertable<OutboundDelivery>) {
  await tx
    .insertInto("outbound_delivery")
    .values(delivery)
    .onConflict((oc) => oc.columns(["organization_id", "logical_key", "recipient"]).doNothing())
    .execute();
}
export function claimDelivery(org: string, now = new Date()) {
  return withTenant(org, async (tx) => {
    await tx
      .updateTable("outbound_delivery")
      .set({ status: "ambiguous", error: "Lease expired; acceptance unknown", updated_at: now })
      .where("organization_id", "=", org)
      .where("status", "=", "sending")
      .where("lease_expires_at", "<=", now)
      .execute();
    const limited = await tx
      .selectFrom("outbound_delivery")
      .select("id")
      .where("organization_id", "=", org)
      .where("error", "=", "Telegram rejection 429")
      .where("next_attempt_at", ">", now)
      .executeTakeFirst();
    if (limited) return null;
    const row = await tx
      .selectFrom("outbound_delivery")
      .selectAll()
      .where("organization_id", "=", org)
      .where("status", "=", "pending")
      .where("next_attempt_at", "<=", now)
      .orderBy("created_at")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!row) return null;
    const member = await memberInTransaction(tx, org, row.recipient);
    const session = row.session_id
      ? await tx
          .selectFrom("scouting_session")
          .select("member_id")
          .where("organization_id", "=", org)
          .where("id", "=", row.session_id)
          .executeTakeFirst()
      : null;
    if (
      !member ||
      (row.admin_only && member.role !== "admin") ||
      (row.session_id && session?.member_id !== member.id)
    ) {
      await tx
        .updateTable("outbound_delivery")
        .set({ status: "cancelled", updated_at: now })
        .where("id", "=", row.id)
        .execute();
      if (row.event_id && row.admin_only)
        await tx
          .updateTable("schedule_notification")
          .set({ status: "cancelled" })
          .where("organization_id", "=", org)
          .where("event_id", "=", row.event_id)
          .where("telegram_user_id", "=", row.recipient)
          .execute();
      return { cancelled: true as const };
    }
    const token = randomUUID();
    await tx
      .updateTable("outbound_delivery")
      .set({
        status: "sending",
        attempts: row.attempts + 1,
        attempted_at: now,
        updated_at: now,
        lease_token: token,
        lease_expires_at: new Date(now.getTime() + 60000),
      })
      .where("id", "=", row.id)
      .execute();
    return { ...row, cancelled: false as const, attempts: row.attempts + 1, lease_token: token };
  });
}
export type DeliveryOutcome =
  | { status: "sent"; messageId: string }
  | { status: "pending" | "failed" | "ambiguous"; error: string; retryMs?: number };
export function settleDelivery(
  org: string,
  id: string,
  token: string,
  outcome: DeliveryOutcome,
  now = new Date(),
) {
  return withTenant(org, async (tx) => {
    const row = await tx
      .selectFrom("outbound_delivery")
      .selectAll()
      .where("organization_id", "=", org)
      .where("id", "=", id)
      .where("lease_token", "=", token)
      .where("status", "=", "sending")
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw Error("Delivery lease lost");
    const status =
      outcome.status === "pending" && row.attempts >= row.max_attempts
        ? "exhausted"
        : outcome.status;
    await tx
      .updateTable("outbound_delivery")
      .set({
        status,
        updated_at: now,
        lease_expires_at: null,
        error: outcome.status === "sent" ? null : outcome.error,
        message_id: outcome.status === "sent" ? outcome.messageId : null,
        sent_at: outcome.status === "sent" ? now : null,
        next_attempt_at: new Date(
          now.getTime() +
            Math.max(
              outcome.status === "pending" ? (outcome.retryMs ?? 0) : 0,
              Math.min(3600000, 30000 * 2 ** row.attempts),
            ),
        ),
      })
      .where("id", "=", id)
      .execute();
    if (outcome.status === "sent" && row.question && row.session_id)
      await tx
        .updateTable("raw_entry")
        .set({ follow_up_message_id: outcome.messageId })
        .where("organization_id", "=", org)
        .where("id", "=", row.session_id)
        .execute();
    if (row.event_id && row.admin_only)
      await tx
        .updateTable("schedule_notification")
        .set({
          status: status === "ambiguous" ? "uncertain" : status === "exhausted" ? "failed" : status,
          sent_at: outcome.status === "sent" ? now : null,
          error: outcome.status === "sent" ? null : outcome.error,
        })
        .where("organization_id", "=", org)
        .where("event_id", "=", row.event_id)
        .where("telegram_user_id", "=", row.recipient)
        .execute();
  });
}
async function admin(tx: Transaction<DB>, org: string, user: string) {
  const member = await memberInTransaction(tx, org, user);
  if (member?.role !== "admin") throw Error("Admin required");
  return member;
}
export function inspectDeliveries(org: string, user: string, offset = 0) {
  return withTenant(org, async (tx) => {
    await admin(tx, org, user);
    return tx
      .selectFrom("outbound_delivery")
      .selectAll()
      .where("organization_id", "=", org)
      .orderBy("created_at", "desc")
      .offset(Math.max(0, Math.floor(offset)))
      .limit(100)
      .execute();
  });
}
export function retryDelivery(
  org: string,
  user: string,
  id: string,
  reason: string,
  acceptDuplicateRisk: boolean,
) {
  if (!reason.trim() || reason.length > 500) throw Error("Provide a reason of 1–500 characters");
  return withTenant(org, async (tx) => {
    const actor = await admin(tx, org, user);
    const row = await tx
      .selectFrom("outbound_delivery")
      .selectAll()
      .where("organization_id", "=", org)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (!["ambiguous", "failed", "exhausted"].includes(row.status))
      throw Error("Delivery is not retryable");
    if (row.status === "ambiguous" && !acceptDuplicateRisk)
      throw Error("Explicit duplicate risk acceptance required");
    await tx
      .insertInto("outbound_intervention")
      .values({
        organization_id: org,
        delivery_id: id,
        actor_id: actor.id,
        reason,
        previous_status: row.status,
        accepted_duplicate_risk: acceptDuplicateRisk,
      })
      .execute();
    await tx
      .updateTable("outbound_delivery")
      .set({
        status: "pending",
        max_attempts: row.attempts + 6,
        next_attempt_at: new Date(),
        lease_token: null,
        operator_id: actor.id,
        operator_reason: reason,
        operator_at: new Date(),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();
  });
}
