import { createHash } from "node:crypto";
import {
  type ExtractionMessage,
  type ExtractionResult,
  finalizeTurns,
  LIMITS_EXTRACTION,
  type ModelExtraction,
  type ObservationKind,
} from "@ai-scouting/scouting";
import { type Selectable, sql, type Transaction } from "kysely";
import type { DB, ScoutingSession } from "../db.generated.ts";
import { extractionReply } from "../extraction-reply.ts";
import { publishedContract } from "./observations.ts";
import { enqueueDelivery } from "./outbound.ts";
import { validateSessionInTransaction } from "./participation.ts";
import { withTenant } from "./tenant.ts";

// Keep the immutable transport envelope in raw_entry, but do not send command words or the
// event UUID as scouting content.
export const noteText = (text: string) =>
  /^\/(?:scout(?:@\w+)?\s+[0-9a-f-]{36}(?:\s+(?:match|pit|general)(?=\s))?|(?:match|pit|general)(?:@\w+)?)\s+([\s\S]+)$/i.exec(
    text.trim(),
  )?.[1] ?? text;

// The publication pinned at intake. Sessions from before #48 have no season; use the event's.
async function pinnedContract(
  tx: Transaction<DB>,
  organizationId: string,
  session: Selectable<ScoutingSession>,
) {
  let season = session.specification_season;
  if (season === null) {
    const event = await tx
      .selectFrom("event")
      .select("season")
      .where("organization_id", "=", organizationId)
      .where("id", "=", session.event_id as string)
      .executeTakeFirstOrThrow();
    season = event.season;
  }
  return publishedContract(
    tx,
    organizationId,
    season,
    session.kind as ObservationKind,
    session.specification_version,
  );
}

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
      .select(["text", "received_at"])
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
    const contract = await pinnedContract(tx, organizationId, session);
    // The follow-up each reply answered gives the model context for short replies like "yes".
    const questions = await tx
      .selectFrom("outbound_delivery")
      .select(["text", "created_at"])
      .where("organization_id", "=", organizationId)
      .where("session_id", "=", row.id)
      .where("question", "=", true)
      .orderBy("created_at")
      .execute();
    const askedBefore = (time: Date) =>
      questions
        .filter((q) => new Date(q.created_at) <= new Date(time))
        .at(-1)
        ?.text.slice(0, LIMITS_EXTRACTION.asked);
    const reextractionSources: { id: string; text: string }[] = [];
    let revisionId = session.reextraction ? session.replaces_revision_id : null;
    const seen = new Set<string>();
    while (revisionId && !seen.has(revisionId)) {
      seen.add(revisionId);
      const source = await tx
        .selectFrom("observation_revision")
        .select(["session_id", "replaces_revision_id"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", revisionId)
        .executeTakeFirstOrThrow();
      const entries = await tx
        .selectFrom("raw_entry")
        .select(["id", "text"])
        .where("organization_id", "=", organizationId)
        .where((eb) =>
          eb.or([eb("id", "=", source.session_id), eb("parent_entry_id", "=", source.session_id)]),
        )
        .orderBy("received_at")
        .orderBy("id")
        .execute();
      reextractionSources.unshift(...entries);
      const sourceSession = await tx
        .selectFrom("scouting_session")
        .select("reextraction")
        .where("organization_id", "=", organizationId)
        .where("id", "=", source.session_id)
        .executeTakeFirstOrThrow();
      revisionId = sourceSession.reextraction ? source.replaces_revision_id : null;
    }
    // One message per turn, in order. An explicit re-extraction replays its sources first.
    const messages: ExtractionMessage[] = [
      ...reextractionSources.map((r) => ({ role: "note" as const, text: noteText(r.text) })),
      { role: "note" as const, text: noteText(row.text) },
      ...replies.map((r) => {
        const asked = askedBefore(r.received_at);
        return { role: "reply" as const, ...(asked ? { asked } : {}), text: r.text };
      }),
    ].slice(-LIMITS_EXTRACTION.messages);
    const text = JSON.stringify({ version: contract.version, messages });
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
      contract,
      messages,
      id: row.id,
      lease,
      chatId: identity.external_id,
      turnId: createHash("sha256").update(text).digest("hex"),
    };
  });
}

export function finishExtraction(
  organizationId: string,
  id: string,
  lease: Date,
  extracted: ModelExtraction,
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
    if (!raw) return { numUpdatedRows: 0n, result: null, notice: null };
    const context = await tx
      .selectFrom("scouting_session")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    const contract = await pinnedContract(tx, organizationId, context);
    if (extracted.specificationVersion !== contract.version) throw Error("Specification mismatch");
    if (!extracted.turns.length || extracted.turns.length > LIMITS_EXTRACTION.messages)
      throw Error("Extraction has no turns");
    // The model reported statements. Validation, rules and completeness run here.
    let result: ExtractionResult = finalizeTurns(contract, extracted.turns);
    const kind = context.kind as ObservationKind;
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
    const unverified = validation.status !== "valid" && validation.status !== "not_applicable";
    // A pit roster mismatch is always a warning the scout can accept, even in strict mode.
    const warns = validation.mode === "warn" || validation.status === "unknown_team";
    const blocked = validation.mode === "strict" && unverified && !warns;
    // Warn preserves the draft and permits an explicit unverified finalization.
    if (warns && unverified && !unverifiedConsent) {
      result = {
        ...result,
        status: "needs_review",
        question:
          validation.status === "unknown_team"
            ? `${validation.message} Reply with the correct team number, or “save unverified” to save this note anyway.`
            : `${validation.message} Reply with corrected details, or “save unverified” to finish with this warning.`,
      };
    } else if (blocked) {
      result = { ...result, status: "needs_review", question: validation.message };
    }
    let conflict: string | null = null;
    if (kind === "match" && validation.matchId && typeof result.values.team_number === "number") {
      const existing = await tx
        .selectFrom("scouting_session")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("event_id", "=", session.event_id)
        .where("member_id", "=", session.member_id)
        .where("match_id", "=", validation.matchId)
        .where("team_number", "=", result.values.team_number)
        .where("kind", "=", "match")
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
    const teamNumber =
      typeof result.values.team_number === "number" ? result.values.team_number : null;
    let staleCorrection = false;
    if (result.status === "complete") {
      if (context.replaces_revision_id) {
        const target = await tx
          .selectFrom("observation_revision")
          .selectAll()
          .where("organization_id", "=", organizationId)
          .where("id", "=", context.replaces_revision_id)
          .where("member_id", "=", raw.member_id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const newer = await tx
          .selectFrom("observation_revision")
          .select("id")
          .where("organization_id", "=", organizationId)
          .where("replaces_revision_id", "=", target.id)
          .executeTakeFirst();
        if (newer) {
          staleCorrection = true;
          result = {
            ...result,
            status: "needs_review",
            question: `Correction target is no longer current. Your draft is retained. Use /flag ${teamNumber ?? "<team-number>"} to request an investigation.`,
          };
        }
      }
    }
    if (result.status === "complete") {
      const event = await tx
        .selectFrom("event")
        .select("season")
        .where("organization_id", "=", organizationId)
        .where("id", "=", context.event_id as string)
        .executeTakeFirstOrThrow();
      const sources = await tx
        .selectFrom("raw_entry")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where((eb) => eb.or([eb("id", "=", id), eb("parent_entry_id", "=", id)]))
        .orderBy("received_at")
        .orderBy("id")
        .execute();
      await tx
        .insertInto("observation_revision")
        .values({
          organization_id: organizationId,
          session_id: id,
          member_id: raw.member_id,
          event_id: context.event_id as string,
          match_id: validation.matchId,
          team_number: teamNumber,
          kind,
          specification_version: contract.version,
          season: context.specification_season ?? event.season,
          values: JSON.stringify(result.values),
          applicability: JSON.stringify({ fields: result.fields, inactive: result.inactive }),
          validation: JSON.stringify(validation),
          outcome:
            validation.mode === "off"
              ? "unchecked"
              : validation.status === "not_applicable"
                ? "unchecked"
                : validation.status === "valid"
                  ? "validated"
                  : "warning_acknowledged",
          provenance: JSON.stringify({
            rawEntryIds: sources.map((r) => r.id),
            reextraction: context.reextraction,
            turns: result.turns,
            history: result.history,
          }),
          replaces_revision_id: context.replaces_revision_id,
        })
        .onConflict((oc) => oc.column("session_id").doNothing())
        .execute();
    }
    const updated = await tx
      .updateTable("raw_entry")
      .set({
        status: result.status === "complete" ? "done" : "needs_review",
        extraction_result: JSON.stringify(result),
        extracted_at: new Date(),
        follow_up_message_id: result.question
          ? (messageId ?? raw.follow_up_message_id)
          : raw.follow_up_message_id,
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
          team_number: teamNumber,
          status: staleCorrection
            ? "superseded"
            : result.status === "complete"
              ? "complete"
              : "collecting",
          completed_at: result.status === "complete" ? new Date() : null,
        })
        .where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .execute();
    }
    const revision = await tx
      .selectFrom("observation_revision")
      .select(["id", "outcome"])
      .where("organization_id", "=", organizationId)
      .where("session_id", "=", id)
      .executeTakeFirst();
    if (revision)
      notice = `${revision.outcome}. Revision ${revision.id}. To request an investigation: /flag ${teamNumber ?? "<team-number>"} [match-number] [note]. Team requests: /flags.`;
    const identity = await tx
      .selectFrom("channel_identity")
      .select("external_id")
      .where("organization_id", "=", organizationId)
      .where("member_id", "=", raw.member_id)
      .where("channel", "=", "telegram")
      .executeTakeFirstOrThrow();
    const turns = await tx
      .selectFrom("raw_entry")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("parent_entry_id", "=", id)
      .orderBy("id")
      .execute();
    await enqueueDelivery(tx, {
      organization_id: organizationId,
      logical_key: `session:${id}:${createHash("sha256").update(JSON.stringify(turns)).digest("hex")}`,
      recipient: identity.external_id,
      session_id: id,
      question: Boolean(result.question),
      text: `${result.question ?? extractionReply(result)}${notice ? `\n${notice}` : ""}`,
    });
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
