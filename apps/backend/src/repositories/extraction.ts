import { createHash } from "node:crypto";
import { type ExtractionResult, requirements } from "@ai-scouting/scouting";
import { sql } from "kysely";
import { validateSessionInTransaction } from "./participation.ts";
import { withTenant } from "./tenant.ts";

export function claimExtraction(organizationId: string) {
  return withTenant(organizationId, async (tx) => {
    const row = await tx
      .selectFrom("raw_entry")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("parent_entry_id", "is", null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("scouting_session")
            .select("scouting_session.id")
            .whereRef("scouting_session.organization_id", "=", "raw_entry.organization_id")
            .whereRef("scouting_session.id", "=", "raw_entry.id")
            .where("scouting_session.event_id", "is not", null),
        ),
      )
      .where("processing_attempts", "<", 3)
      .where("next_attempt_at", "<=", sql<Date>`now()`)
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
    const session = await tx
      .selectFrom("scouting_session")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", row.id)
      .executeTakeFirstOrThrow();
    if (session.specification_version !== requirements.version)
      throw Error("Session specification changed; operator migration required");
    // Keep the immutable transport envelope in raw_entry, but do not send its UUID as scouting content.
    const original =
      /^\/scout(?:@\w+)?\s+[0-9a-f-]{36}\s+([\s\S]+)$/i.exec(row.text.trim())?.[1] ?? row.text;
    const text = JSON.stringify({ original, followUps: replies.map((r) => r.text) });
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
    const raw = await tx
      .selectFrom("raw_entry")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("processing_started_at", "=", lease)
      .forUpdate()
      .executeTakeFirst();
    if (!raw) return { numUpdatedRows: 0n, result, notice: null };
    // Serialize identity resolution for this scout. Provisional notes remain independent.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${raw.member_id}`}, 31))`.execute(
      tx,
    );
    const { session, validation } = await validateSessionInTransaction(
      tx,
      organizationId,
      id,
      result.values,
    );
    const replies = await tx
      .selectFrom("raw_entry")
      .select("text")
      .where("organization_id", "=", organizationId)
      .where("parent_entry_id", "=", id)
      .orderBy("received_at", "desc")
      .orderBy("id", "desc")
      .execute();
    const answer = replies[0]?.text.trim().toLowerCase();
    const prior =
      session.validation_result &&
      typeof session.validation_result === "object" &&
      !Array.isArray(session.validation_result)
        ? session.validation_result
        : {};
    const sameIdentity =
      prior.matchLabel === result.values.match && prior.teamNumber === result.values.team_number;
    const separateConsent =
      answer === "keep separate" || (sameIdentity && prior.separateConsent === true);
    const unverifiedConsent =
      answer === "save unverified" || (sameIdentity && prior.unverifiedConsent === true);
    let notice = validation.message;
    const blocked = validation.mode === "strict" && validation.status !== "valid";
    // Warn preserves the draft and permits an explicit unverified finalization.
    if (validation.mode === "warn" && validation.status !== "valid" && !unverifiedConsent) {
      result = {
        ...result,
        status: "needs_review",
        question: `${validation.message} Reply with corrected details, or “save unverified” to finish with this warning.`,
      };
    } else if (blocked) {
      result = { ...result, status: "needs_review", question: validation.message };
    }
    let conflict: string | null = null;
    if (validation.matchId && typeof result.values.team_number === "number") {
      const existing = await tx
        .selectFrom("scouting_session")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("event_id", "=", session.event_id)
        .where("member_id", "=", session.member_id)
        .where("match_id", "=", validation.matchId)
        .where("team_number", "=", result.values.team_number)
        .where("status", "=", "collecting")
        .where("created_at", "<", session.created_at)
        .where("id", "!=", id)
        .orderBy("created_at")
        .executeTakeFirst();
      if (existing && !separateConsent) conflict = existing.id;
    }
    if (conflict) {
      notice = `Another open session (${conflict}) already targets this event, match and team. This note is stored separately and has not been merged. Reply “keep separate” to continue this independent note. To add to the earlier session, reply to its original question explicitly.`;
      result = { ...result, status: "needs_review", question: notice };
    }
    const updated = await tx
      .updateTable("raw_entry")
      .set({
        status: result.status === "complete" ? "done" : messageId ? "needs_review" : "processing",
        extraction_result: JSON.stringify(result),
        follow_up_message_id: result.question
          ? (messageId ?? raw.follow_up_message_id)
          : raw.follow_up_message_id,
        processing_started_at: result.question && !messageId ? lease : null,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("processing_started_at", "=", lease)
      .executeTakeFirst();
    if (updated.numUpdatedRows === 1n) {
      await tx
        .updateTable("scouting_session")
        .set({
          match_id: validation.matchId,
          validation_result: JSON.stringify({
            ...validation,
            conflictSessionId: conflict,
            separateConsent,
            unverifiedConsent,
            matchLabel: result.values.match,
            teamNumber: result.values.team_number,
          }),
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
    return { ...updated, result, notice };
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

// Delivery metadata is recorded independently after the validated draft has committed.
export function recordExtractionQuestion(
  organizationId: string,
  id: string,
  lease: Date,
  messageId: string,
) {
  return withTenant(organizationId, (tx) =>
    tx
      .updateTable("raw_entry")
      .set({
        follow_up_message_id: messageId,
        status: "needs_review",
        processing_started_at: null,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("processing_started_at", "=", lease)
      .where("status", "=", "processing")
      .execute(),
  );
}
