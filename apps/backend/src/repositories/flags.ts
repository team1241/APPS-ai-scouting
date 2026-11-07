import { sql } from "kysely";
import { matchLabelKey, parseFlagRequest } from "../flag-command.ts";
import { memberInTransaction } from "./membership.ts";
import { withTenant } from "./tenant.ts";

export function submitObservationFlag(input: {
  organizationId: string;
  userId: string;
  updateId: string;
  argument: string;
  commandText: string;
}) {
  const request = parseFlagRequest(input.argument);
  return withTenant(input.organizationId, async (tx) => {
    const member = await memberInTransaction(tx, input.organizationId, input.userId);
    if (!member) return { status: "forbidden" as const };
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:flag:${input.updateId}`}, 41))`.execute(
      tx,
    );
    const existing = await tx
      .selectFrom("observation_flag")
      .selectAll()
      .where("organization_id", "=", input.organizationId)
      .where("external_update_id", "=", input.updateId)
      .executeTakeFirst();
    if (existing)
      return existing.member_id === member.id
        ? { status: "saved" as const, flag: existing, duplicate: true }
        : { status: "forbidden" as const };
    if (!request) return { status: "invalid" as const };
    const rows = await tx
      .selectFrom("observation_revision as revision")
      .leftJoin("event_match", (join) =>
        join
          .onRef("event_match.organization_id", "=", "revision.organization_id")
          .onRef("event_match.id", "=", "revision.match_id")
          .onRef("event_match.event_id", "=", "revision.event_id"),
      )
      .selectAll("revision")
      .select("event_match.identity as match_identity")
      .where("revision.organization_id", "=", input.organizationId)
      .where("revision.member_id", "=", member.id)
      .where("revision.team_number", "=", request.teamNumber)
      .where("revision.kind", "=", "match")
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("observation_revision as newer")
              .select("newer.id")
              .where("newer.organization_id", "=", input.organizationId)
              .whereRef("newer.replaces_revision_id", "=", "revision.id"),
          ),
        ),
      )
      .orderBy("revision.created_at", "desc")
      .orderBy("revision.id", "desc")
      .execute();
    const candidates = request.matchLabel
      ? rows.filter((row) => {
          const values = row.values;
          const label =
            values && typeof values === "object" && !Array.isArray(values) ? values.match : null;
          return (
            (typeof label === "string" &&
              matchLabelKey(label) === matchLabelKey(request.matchLabel as string)) ||
            (row.match_identity !== null &&
              matchLabelKey(row.match_identity) === matchLabelKey(request.matchLabel as string))
          );
        })
      : rows;
    if (!candidates.length) return { status: "missing" as const };
    if (
      (request.matchLabel && candidates.length > 1) ||
      (!request.matchLabel &&
        candidates.length > 1 &&
        candidates[0]?.created_at.getTime() === candidates[1]?.created_at.getTime())
    )
      return { status: "ambiguous" as const };
    const target = candidates[0];
    if (!target) return { status: "missing" as const };
    const flag = await tx
      .insertInto("observation_flag")
      .values({
        organization_id: input.organizationId,
        revision_id: target.id,
        member_id: member.id,
        external_update_id: input.updateId,
        team_number: request.teamNumber,
        requested_match_label: request.matchLabel,
        note: request.note,
        command_text: input.commandText,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { status: "saved" as const, flag, duplicate: false };
  });
}

// All enrolled teammates may investigate flags, including the original immutable data.
export function readObservationFlags(organizationId: string, userId: string, flagId?: string) {
  return withTenant(organizationId, async (tx) => {
    if (!(await memberInTransaction(tx, organizationId, userId))) return null;
    let query = tx
      .selectFrom("observation_flag as flag")
      .innerJoin("observation_revision as revision", (join) =>
        join
          .onRef("revision.organization_id", "=", "flag.organization_id")
          .onRef("revision.id", "=", "flag.revision_id"),
      )
      .innerJoin("event", (join) =>
        join
          .onRef("event.organization_id", "=", "revision.organization_id")
          .onRef("event.id", "=", "revision.event_id"),
      )
      .innerJoin("member", (join) =>
        join
          .onRef("member.organization_id", "=", "flag.organization_id")
          .onRef("member.id", "=", "flag.member_id"),
      )
      .selectAll("flag")
      .select(sql<string | null>`${sql.ref("revision.values")} ->> 'match'`.as("match_label"))
      .select((eb) =>
        eb
          .not(
            eb.exists(
              eb
                .selectFrom("observation_revision as newer")
                .select("newer.id")
                .where("newer.organization_id", "=", organizationId)
                .whereRef("newer.replaces_revision_id", "=", "revision.id"),
            ),
          )
          .as("revision_current"),
      )
      .select([
        "event.name as event_name",
        "revision.event_id",
        "revision.values",
        "revision.validation",
        "revision.provenance",
        "revision.specification_version",
        "revision.outcome",
        "member.name as scout_name",
      ])
      .where("flag.organization_id", "=", organizationId);
    if (flagId) query = query.where("flag.id", "=", flagId);
    return query.orderBy("flag.created_at", "desc").orderBy("flag.id", "desc").limit(20).execute();
  });
}
