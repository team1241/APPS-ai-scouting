import {
  contractFormat,
  type ObservationKind,
  readContract,
  specificationSchema,
} from "@ai-scouting/scouting";
import { sql } from "kysely";
import {
  type ExportRow,
  exportObservation,
  type PageRequest,
  pageResult,
  type ReadScope,
} from "../scouting-data.ts";
import { withTenant } from "./tenant.ts";

// Follow explicit correction links to a logical root. Independent submissions never merge.
// Select the latest successfully extracted session per root before applying team filters:
// a correction that changes team identity must remove the old team's record too.
const current = (org: string, eventId?: string) => sql`
  WITH RECURSIVE lineage AS (
    SELECT s.id, s.id AS root_id FROM scouting_session s
    WHERE s.organization_id = ${org} AND s.replaces_revision_id IS NULL
      ${eventId ? sql`AND s.event_id = ${eventId}::uuid` : sql``}
    UNION ALL
    SELECT child.id, l.root_id FROM lineage l
    JOIN observation_revision v ON v.session_id = l.id AND v.organization_id = ${org}
    JOIN scouting_session child ON child.replaces_revision_id = v.id AND child.organization_id = ${org}
  ), current_records AS (
    SELECT DISTINCT ON (l.root_id) l.root_id, s.event_id, s.kind, s.specification_season,
      s.team_number, s.match_id, s.match_label, s.specification_version, r.extracted_at,
      r.extraction_result,
      s.validation_result
    FROM lineage l
    JOIN scouting_session s ON s.id = l.id AND s.organization_id = ${org}
    JOIN raw_entry r ON r.id = s.id AND r.organization_id = ${org}
    WHERE s.status <> 'superseded' AND r.extraction_result IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM observation_revision winner
        WHERE winner.organization_id = ${org}
          AND winner.replaces_revision_id = s.replaces_revision_id
          AND winner.session_id <> s.id
      )
      AND r.extracted_at IS NOT NULL
    ORDER BY l.root_id, r.extracted_at DESC, s.created_at DESC, s.id DESC
  )`;

export function readScoutingEvents(scope: ReadScope, page: PageRequest) {
  return withTenant(scope.organizationId, async (tx) => {
    const { rows } = await sql<{
      id: string;
      name: string;
      season: number;
      startDate: string;
      endDate: string;
      timezone: string;
      eventCode: string | null;
    }>`
      ${current(scope.organizationId)}
      SELECT e.id, e.name, e.season, coalesce(e.frc_event_code, e.tba_event_key) AS "eventCode", e.start_date AS "startDate", e.end_date AS "endDate", e.timezone
      FROM event e WHERE e.organization_id = ${scope.organizationId}
        AND EXISTS (SELECT 1 FROM current_records c WHERE c.event_id = e.id AND c.team_number = ${scope.teamNumber})
        ${page.after ? sql`AND e.id > ${page.after}::uuid` : sql``}
      ORDER BY e.id LIMIT ${page.limit + 1}
    `.execute(tx);
    return pageResult(rows, page, scope, (event) => event.id);
  });
}

export function readScoutingObservations(scope: ReadScope, page: PageRequest) {
  return withTenant(scope.organizationId, async (tx) => {
    const event = await tx
      .selectFrom("event")
      .select("id")
      .where("organization_id", "=", scope.organizationId)
      .where("id", "=", scope.eventId as string)
      .executeTakeFirst();
    if (!event) return null;
    const { rows } = await sql<ExportRow>`
      ${current(scope.organizationId, scope.eventId)}
      SELECT c.root_id, c.event_id, coalesce(e.frc_event_code, e.tba_event_key) AS event_code, e.name AS event_label,
        c.kind, c.team_number, c.match_id, c.match_label, m.stage AS match_stage, m.match_number,
        c.specification_version, c.extracted_at, c.extraction_result, c.validation_result, p.document
      FROM current_records c
      JOIN event e ON e.id = c.event_id AND e.organization_id = ${scope.organizationId}
      LEFT JOIN event_match m ON m.id = c.match_id AND m.event_id = c.event_id
        AND m.organization_id = ${scope.organizationId}
      JOIN published_specification p ON p.organization_id = ${scope.organizationId}
        AND p.season = coalesce(c.specification_season, e.season) AND p.kind = c.kind
        AND p.version = c.specification_version
      -- Match and pit records need a team. General notes may have none.
      WHERE (c.team_number IS NOT NULL OR c.kind = 'general')
        ${scope.teamNumber ? sql`AND c.team_number = ${scope.teamNumber}` : sql``}
        ${page.after ? sql`AND c.root_id > ${page.after}::uuid` : sql``}
      ORDER BY c.root_id LIMIT ${page.limit + 1}
    `.execute(tx);
    const result = pageResult(rows, page, scope, (row) => row.root_id);
    return {
      ...result,
      data: result.data.map((row) => exportObservation(scope.organizationId, row)),
    };
  });
}

// Publication for consumers: codes, labels, requirement, answer constraints and rules, so they
// can interpret per-question state. Model guidance and scout prompts are not exported.
export function readScoutingSpecification(
  org: string,
  eventId: string,
  version: string,
  kind: ObservationKind = "match",
) {
  return withTenant(org, async (tx) => {
    const row = await tx
      .selectFrom("event as e")
      .innerJoin("published_specification as p", (join) =>
        join
          .onRef("p.organization_id", "=", "e.organization_id")
          .onRef("p.season", "=", "e.season"),
      )
      .select("p.document")
      .where("e.organization_id", "=", org)
      .where("e.id", "=", eventId)
      .where("p.organization_id", "=", org)
      .where("p.kind", "=", kind)
      .where("p.version", "=", version)
      .executeTakeFirst();
    if (!row) return null;
    const contract = readContract(row.document, kind);
    const legacy = specificationSchema.safeParse(row.document);
    return {
      version: contract.version,
      kind,
      formatVersion: contractFormat(row.document),
      description: contract.description,
      questions: contract.questions.map(({ key, label, required, answer, rules }) => ({
        key,
        label,
        required,
        answer,
        ...(rules?.length ? { rules } : {}),
      })),
      // Format 1 shape, kept for existing integrations.
      ...(legacy.success
        ? {
            fields: legacy.data.fields.map(({ key, type, required, description }) => ({
              key,
              type,
              required,
              description,
            })),
          }
        : {}),
    };
  });
}

export const scoutingReads = {
  events: readScoutingEvents,
  observations: readScoutingObservations,
  specification: readScoutingSpecification,
};
export type ScoutingReads = typeof scoutingReads;
