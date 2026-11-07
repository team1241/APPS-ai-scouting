import { requirements, type Specification, specificationSchema } from "@ai-scouting/scouting";
import type { Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import { lockEventContext } from "./events.ts";
import { withTenant } from "./tenant.ts";

export async function sessionSpecification(
  tx: Transaction<DB>,
  organizationId: string,
  eventId: string,
  version: string,
) {
  const event = await tx
    .selectFrom("event")
    .select("season")
    .where("organization_id", "=", organizationId)
    .where("id", "=", eventId)
    .executeTakeFirstOrThrow();
  // Bootstrap only the known starter document. Existing publications are never overwritten.
  if (version === requirements.version)
    await tx
      .insertInto("published_specification")
      .values({
        organization_id: organizationId,
        season: event.season,
        kind: "match",
        version,
        document: JSON.stringify(requirements),
      })
      .onConflict((oc) => oc.columns(["organization_id", "season", "kind", "version"]).doNothing())
      .execute();
  const row = await tx
    .selectFrom("published_specification")
    .select("document")
    .where("organization_id", "=", organizationId)
    .where("season", "=", event.season)
    .where("kind", "=", "match")
    .where("version", "=", version)
    .executeTakeFirstOrThrow();
  return specificationSchema.parse(row.document);
}

export function publishSpecification(
  organizationId: string,
  userId: string,
  season: number,
  kind: "match" | "pit" | "general",
  input: Specification,
) {
  const document = specificationSchema.parse(input);
  if (new Set(document.fields.map((f) => f.key)).size !== document.fields.length)
    throw Error("Duplicate fields");
  if (
    kind === "match" &&
    !["match", "team_number"].every((key) =>
      document.fields.some(
        (f) => f.key === key && f.required && f.type === (key === "match" ? "text" : "integer"),
      ),
    )
  )
    throw Error("Match identity fields required");
  return withTenant(organizationId, async (tx) => {
    const member = await tx
      .selectFrom("channel_identity")
      .innerJoin("member", "member.id", "channel_identity.member_id")
      .select("member.role")
      .where("channel_identity.organization_id", "=", organizationId)
      .where("member.organization_id", "=", organizationId)
      .where("channel", "=", "telegram")
      .where("external_id", "=", userId)
      .executeTakeFirst();
    if (member?.role !== "admin") throw Error("Forbidden");
    await tx
      .insertInto("published_specification")
      .values({
        organization_id: organizationId,
        season,
        kind,
        version: document.version,
        document: JSON.stringify(document),
      })
      .execute();
  });
}

export function readObservationHistory(organizationId: string, userId: string) {
  return withTenant(organizationId, async (tx) => {
    const member = await tx
      .selectFrom("channel_identity")
      .innerJoin("member", "member.id", "channel_identity.member_id")
      .select(["member.id", "member.role"])
      .where("channel_identity.organization_id", "=", organizationId)
      .where("member.organization_id", "=", organizationId)
      .where("external_id", "=", userId)
      .where("channel", "=", "telegram")
      .executeTakeFirstOrThrow();
    let query = tx
      .selectFrom("observation_revision")
      .selectAll()
      .where("organization_id", "=", organizationId);
    if (member.role === "scout") query = query.where("member_id", "=", member.id);
    const rows = await query.orderBy("created_at").execute();
    const replaced = new Set(rows.map((r) => r.replaces_revision_id));
    return rows.map((row) => ({
      ...row,
      current: !replaced.has(row.id),
      validCoverage: !replaced.has(row.id) && row.outcome === "validated",
    }));
  });
}

// Select a published version for new sessions only. Open sessions keep their assignment.
export function selectSpecification(
  organizationId: string,
  userId: string,
  eventId: string,
  version: string,
) {
  return withTenant(organizationId, async (tx) => {
    await lockEventContext(tx, organizationId);
    const member = await tx
      .selectFrom("channel_identity")
      .innerJoin("member", "member.id", "channel_identity.member_id")
      .select("member.role")
      .where("channel_identity.organization_id", "=", organizationId)
      .where("member.organization_id", "=", organizationId)
      .where("external_id", "=", userId)
      .where("channel", "=", "telegram")
      .executeTakeFirst();
    if (member?.role !== "admin") throw Error("Forbidden");
    const event = await tx
      .selectFrom("event")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", eventId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await sessionSpecification(tx, organizationId, eventId, version);
    await tx
      .updateTable("event")
      .set({ specification_version: version })
      .where("organization_id", "=", organizationId)
      .where("id", "=", event.id)
      .execute();
  });
}
