import { activeEvent, lockEventContext } from "./events.ts";
import { sessionSpecification } from "./observations.ts";
import { withTenant } from "./tenant.ts";

interface IncomingNote {
  organizationId: string;
  channel: string;
  externalUserId: string;
  externalUpdateId: string;
  text: string;
  replyToMessageId?: string;
  eventId?: string;
  correctionRevisionId?: string;
  reextract?: boolean;
}
type Rejection = "no_active_event" | "invalid_event" | "legacy_session" | "completed_session";
// Context validation, deduplication and persistence share one transaction.
export function saveIncomingNote(
  note: IncomingNote,
): Promise<
  "unknown" | "duplicate" | Rejection | { status: "saved"; sessionId: string; eventName: string }
> {
  return withTenant(note.organizationId, async (tx) => {
    const identity = await tx
      .selectFrom("channel_identity")
      .select("member_id")
      .where("organization_id", "=", note.organizationId)
      .where("channel", "=", note.channel)
      .where("external_id", "=", note.externalUserId)
      .executeTakeFirst();
    if (!identity) return "unknown";
    await lockEventContext(tx, note.organizationId);
    const delivery = {
      organization_id: note.organizationId,
      channel: note.channel,
      external_update_id: note.externalUpdateId,
    };
    const existing = await tx
      .selectFrom("raw_entry")
      .select("id")
      .where("organization_id", "=", note.organizationId)
      .where("channel", "=", note.channel)
      .where("external_update_id", "=", note.externalUpdateId)
      .executeTakeFirst();
    if (existing) return "duplicate";
    const rejected = await tx
      .selectFrom("intake_rejection")
      .select("reason")
      .where("organization_id", "=", note.organizationId)
      .where("channel", "=", note.channel)
      .where("external_update_id", "=", note.externalUpdateId)
      .executeTakeFirst();
    if (rejected) return rejected.reason as Rejection;
    const reject = async (reason: Rejection) => {
      // Retain only delivery metadata, not the rejected note. A retry must not adopt a later event.
      await tx
        .insertInto("intake_rejection")
        .values({ ...delivery, reason })
        .execute();
      return reason;
    };
    const correction = note.correctionRevisionId
      ? await tx
          .selectFrom("observation_revision")
          .selectAll()
          .where("organization_id", "=", note.organizationId)
          .where("member_id", "=", identity.member_id)
          .where("id", "=", note.correctionRevisionId)
          .executeTakeFirst()
      : undefined;
    if (note.correctionRevisionId && !correction) return reject("completed_session");
    if (
      correction &&
      (await tx
        .selectFrom("observation_revision")
        .select("id")
        .where("organization_id", "=", note.organizationId)
        .where("replaces_revision_id", "=", correction.id)
        .executeTakeFirst())
    )
      return reject("completed_session");
    const parents =
      note.replyToMessageId && !correction
        ? await tx
            .selectFrom("raw_entry")
            .select(["id", "status"])
            .where("organization_id", "=", note.organizationId)
            .where("member_id", "=", identity.member_id)
            .where("follow_up_message_id", "=", note.replyToMessageId)
            .where("parent_entry_id", "is", null)
            .forUpdate()
            .limit(2)
            .execute()
        : [];
    if (parents.length > 1) return reject("completed_session");
    const parent = parents[0];
    if (parent?.status === "done") return reject("completed_session");
    let eventId: string, eventName: string, specificationVersion: string;
    if (correction) {
      const event = await tx
        .selectFrom("event")
        .selectAll()
        .where("organization_id", "=", note.organizationId)
        .where("id", "=", correction.event_id)
        .executeTakeFirstOrThrow();
      eventId = event.id;
      eventName = event.name;
      specificationVersion = correction.specification_version;
    } else if (parent) {
      const context = await tx
        .selectFrom("scouting_session")
        .innerJoin("event", (join) =>
          join
            .onRef("event.id", "=", "scouting_session.event_id")
            .onRef("event.organization_id", "=", "scouting_session.organization_id"),
        )
        .select(["event.id", "event.name", "scouting_session.specification_version"])
        .where("scouting_session.organization_id", "=", note.organizationId)
        .where("scouting_session.id", "=", parent.id)
        .executeTakeFirst();
      if (!context) return reject("legacy_session");
      eventId = context.id;
      eventName = context.name;
      specificationVersion = context.specification_version;
    } else {
      const active = await activeEvent(tx, note.organizationId);
      if (!active || active.archived) return reject("no_active_event");
      const selected = note.eventId
        ? await tx
            .selectFrom("event")
            .selectAll()
            .where("organization_id", "=", note.organizationId)
            .where("id", "=", note.eventId)
            .executeTakeFirst()
        : active;
      if (!selected || selected.archived) return reject("invalid_event");
      eventId = selected.id;
      eventName = selected.name;
      specificationVersion = selected.specification_version;
    }
    await sessionSpecification(tx, note.organizationId, eventId, specificationVersion);
    const entry = await tx
      .insertInto("raw_entry")
      .values({
        ...delivery,
        member_id: identity.member_id,
        text: note.text,
        follow_up_message_id: null,
        parent_entry_id: parent?.id ?? null,
        status: parent ? "done" : "pending",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (parent)
      await tx
        .updateTable("raw_entry")
        .set({
          status: "pending",
          processing_started_at: null,
          processing_attempts: 0,
          next_attempt_at: new Date(),
        })
        .where("organization_id", "=", note.organizationId)
        .where("id", "=", parent.id)
        .execute();
    else
      await tx
        .insertInto("scouting_session")
        .values({
          id: entry.id,
          organization_id: note.organizationId,
          member_id: identity.member_id,
          event_id: eventId,
          specification_version: specificationVersion,
          replaces_revision_id: correction?.id ?? null,
          reextraction: !!note.reextract,
        })
        .execute();
    return { status: "saved", sessionId: parent?.id ?? entry.id, eventName };
  });
}
