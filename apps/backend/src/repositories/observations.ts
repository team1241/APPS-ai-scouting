import {
  type Contract,
  ContractError,
  type ObservationKind,
  readContract,
  requirements,
  type Specification,
  specificationSchema,
  upgradeLegacySpecification,
  validateContract,
} from "@ai-scouting/scouting";
import type { Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import { lockEventContext } from "./events.ts";
import { withTenant } from "./tenant.ts";

// Read the publication a session is pinned to. Publications are immutable, so the
// season, kind and version identify the document. Format 1 keeps its original semantics.
export async function publishedContract(
  tx: Transaction<DB>,
  organizationId: string,
  season: number,
  kind: ObservationKind,
  version: string,
): Promise<Contract> {
  // Bootstrap only the known starter document. Existing publications are never overwritten.
  if (kind === "match" && version === requirements.version)
    await tx
      .insertInto("published_specification")
      .values({
        organization_id: organizationId,
        season,
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
    .where("season", "=", season)
    .where("kind", "=", kind)
    .where("version", "=", version)
    .executeTakeFirstOrThrow();
  return readContract(row.document, kind);
}

export async function sessionSpecification(
  tx: Transaction<DB>,
  organizationId: string,
  eventId: string,
  version: string,
  kind: ObservationKind = "match",
) {
  const event = await tx
    .selectFrom("event")
    .select("season")
    .where("organization_id", "=", organizationId)
    .where("id", "=", eventId)
    .executeTakeFirstOrThrow();
  return publishedContract(tx, organizationId, event.season, kind, version);
}

export function publishSpecification(
  organizationId: string,
  userId: string,
  season: number,
  kind: "match" | "pit" | "general",
  input: Specification,
) {
  const document = specificationSchema.parse(input);
  // Shared contract validation: duplicate codes and protected identity for the kind.
  const validation = validateContract(upgradeLegacySpecification(document, kind), kind);
  if (!validation.ok) throw new ContractError(validation.issues);
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
