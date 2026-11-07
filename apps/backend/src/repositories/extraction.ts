import { createHash } from "node:crypto";
import { type ExtractionResult, requirements } from "@ai-scouting/scouting";
import { sql } from "kysely";
import { withTenant } from "./tenant.ts";

export function claimExtraction(organizationId: string) {
  return withTenant(organizationId, async (tx) => {
    const row = await tx
      .selectFrom("raw_entry")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("parent_entry_id", "is", null)
      .where("processing_attempts", "<", 3)
      .where("next_attempt_at", "<=", new Date())
      .where((eb) =>
        eb.or([
          eb("status", "in", ["pending", "failed"]),
          eb.and([
            eb("status", "=", "processing"),
            eb("processing_started_at", "<", new Date(Date.now() - 300000)),
          ]),
        ]),
      )
      .orderBy("received_at")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!row) return null;
    const identity = await tx
      .selectFrom("channel_identity")
      .select("external_id")
      .where("organization_id", "=", organizationId)
      .where("member_id", "=", row.member_id)
      .where("channel", "=", "telegram")
      .executeTakeFirstOrThrow();
    const replies = await tx
      .selectFrom("raw_entry")
      .select("text")
      .where("organization_id", "=", organizationId)
      .where("parent_entry_id", "=", row.id)
      .orderBy("received_at")
      .orderBy("id")
      .execute();
    await tx
      .insertInto("scouting_session")
      .values({
        id: row.id,
        organization_id: organizationId,
        member_id: row.member_id,
        specification_version: requirements.version,
      })
      .onConflict((oc) => oc.columns(["organization_id", "id"]).doNothing())
      .execute();
    const session = await tx
      .selectFrom("scouting_session")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", row.id)
      .executeTakeFirstOrThrow();
    if (session.specification_version !== requirements.version)
      throw Error("Session specification changed; operator migration required");
    const text = JSON.stringify({ original: row.text, followUps: replies.map((r) => r.text) });
    const lease = new Date();
    await tx
      .updateTable("raw_entry")
      .set({
        status: "processing",
        processing_started_at: lease,
        processing_attempts: sql`processing_attempts + 1`,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", row.id)
      .execute();
    return {
      id: row.id,
      lease,
      chatId: identity.external_id,
      text,
      turnId: createHash("sha256").update(text).digest("hex"),
    };
  });
}

export function finishExtraction(
  organizationId: string,
  id: string,
  lease: Date,
  result: ExtractionResult,
  messageId: string | null,
) {
  return withTenant(organizationId, async (tx) => {
    const updated = await tx
      .updateTable("raw_entry")
      .set({
        status: result.status === "complete" ? "done" : "needs_review",
        extraction_result: JSON.stringify(result),
        follow_up_message_id: messageId,
        processing_started_at: null,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("processing_started_at", "=", lease)
      .executeTakeFirst();
    if (updated.numUpdatedRows === 1n) {
      await tx
        .updateTable("scouting_session")
        .set({
          match_label: typeof result.values.match === "string" ? result.values.match : null,
          team_number:
            typeof result.values.team_number === "number" ? result.values.team_number : null,
          status: result.status === "complete" ? "complete" : "collecting",
          completed_at: result.status === "complete" ? new Date() : null,
        })
        .where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .execute();
    }
    return updated;
  });
}

export function failExtraction(organizationId: string, id: string, lease: Date) {
  return withTenant(organizationId, (tx) =>
    tx
      .updateTable("raw_entry")
      .set({
        status: "failed",
        processing_started_at: null,
        next_attempt_at: new Date(Date.now() + 60000),
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("processing_started_at", "=", lease)
      .execute(),
  );
}
