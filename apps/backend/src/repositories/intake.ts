import { withTenant } from "./tenant.ts";

interface IncomingNote {
  organizationId: string;
  channel: string;
  externalUserId: string;
  externalUpdateId: string;
  text: string;
  replyToMessageId?: string;
}

// Identity lookup and deduplicated insert commit together before returning.
export function saveIncomingNote(note: IncomingNote): Promise<"unknown" | "saved" | "duplicate"> {
  return withTenant(note.organizationId, async (tx) => {
    const identity = await tx
      .selectFrom("channel_identity")
      .select("member_id")
      .where("organization_id", "=", note.organizationId)
      .where("channel", "=", note.channel)
      .where("external_id", "=", note.externalUserId)
      .executeTakeFirst();
    if (!identity) return "unknown";
    const parent = note.replyToMessageId
      ? await tx
          .selectFrom("raw_entry")
          .select("id")
          .where("organization_id", "=", note.organizationId)
          .where("member_id", "=", identity.member_id)
          .where("follow_up_message_id", "=", note.replyToMessageId)
          .where("status", "=", "needs_review")
          .where("parent_entry_id", "is", null)
          .forUpdate()
          .executeTakeFirst()
      : undefined;
    const entry = await tx
      .insertInto("raw_entry")
      .values({
        organization_id: note.organizationId,
        member_id: identity.member_id,
        channel: note.channel,
        external_update_id: note.externalUpdateId,
        text: note.text,
        follow_up_message_id: null,
        parent_entry_id: parent?.id ?? null,
        status: parent ? "done" : "pending",
      })
      .onConflict((oc) =>
        oc.columns(["organization_id", "channel", "external_update_id"]).doNothing(),
      )
      .returning("id")
      .executeTakeFirst();
    if (entry && parent)
      await tx
        .updateTable("raw_entry")
        .set({ status: "pending", processing_attempts: 0, next_attempt_at: new Date() })
        .where("organization_id", "=", note.organizationId)
        .where("id", "=", parent.id)
        .execute();
    return entry ? "saved" : "duplicate";
  });
}
