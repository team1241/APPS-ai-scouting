import { createHash } from "node:crypto";
import { specificationSchema } from "@ai-scouting/scouting";
import { uuidPattern } from "./event-config.ts";

export interface PageRequest {
  limit: number;
  after: string | null;
}
export interface ReadScope {
  organizationId: string;
  eventId?: string;
  teamNumber?: number;
}
export class InvalidPage extends Error {}

// Cursors encode position and scope, not authority. Every query still uses the verified tenant.
export function readPage(query: Record<string, string>, scope: ReadScope): PageRequest {
  for (const key of Object.keys(query))
    if (!["limit", "cursor"].includes(key)) throw new InvalidPage("Unknown query parameter");
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (query.limit !== undefined && !/^[1-9]\d*$/.test(query.limit))
    throw new InvalidPage("limit must be an integer from 1 to 100");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new InvalidPage("limit must be an integer from 1 to 100");
  if (query.cursor === undefined) return { limit, after: null };
  try {
    if (query.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw Error();
    const cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
    if (
      cursor.v !== 1 ||
      cursor.organizationId !== scope.organizationId ||
      cursor.eventId !== scope.eventId ||
      cursor.teamNumber !== scope.teamNumber ||
      typeof cursor.after !== "string" ||
      !uuidPattern.test(cursor.after)
    )
      throw Error();
    return { limit, after: cursor.after };
  } catch {
    throw new InvalidPage("Invalid cursor for this request");
  }
}

export function pageResult<T>(
  rows: T[],
  request: PageRequest,
  scope: ReadScope,
  id: (row: T) => string,
) {
  const data = rows.slice(0, request.limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      rows.length > request.limit && last
        ? Buffer.from(JSON.stringify({ v: 1, ...scope, after: id(last) })).toString("base64url")
        : null,
  };
}

export interface ExportRow {
  root_id: string;
  event_id: string;
  event_code: string | null;
  event_label: string;
  team_number: number | null;
  match_id: string | null;
  match_label: string | null;
  match_stage: string | null;
  match_number: number | null;
  specification_version: string;
  extracted_at: Date;
  extraction_result: unknown;
  validation_result: unknown;
  document: unknown;
}
const object = (input: unknown): Record<string, unknown> =>
  input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

// Normalize display labels only; qualification formatting does not resolve a match.
function matchLabel(row: ExportRow): string | null {
  if (row.match_stage === "qualification" && row.match_number !== null)
    return `Q${row.match_number}`;
  if (row.match_stage === "playoff") return row.match_label;
  const label = row.match_label?.trim() ?? null;
  const qualification =
    label && /^(?:(?:qm?|qualification(?:\s+match)?)\s*:?\s*)?0*([1-9]\d*)$/i.exec(label);
  return qualification ? `Q${qualification[1]}` : label;
}

// Explicit allowlist: never serialize extraction questions, provenance or internal validation details.
export function exportObservation(org: string, row: ExportRow) {
  const specification = specificationSchema.parse(row.document);
  const result = object(row.extraction_result);
  const source = object(result.values);
  const values = Object.fromEntries(
    specification.fields.map((field) => {
      const value = source[field.key];
      const valid =
        value === null ||
        (field.type === "text" && typeof value === "string") ||
        (field.type === "boolean" && typeof value === "boolean") ||
        (field.type === "integer" && typeof value === "number" && Number.isSafeInteger(value));
      return [field.key, valid ? value : null];
    }),
  );
  const label = matchLabel(row);
  if (Object.hasOwn(values, "match")) values.match = label;
  const validation = object(row.validation_result);
  const statuses = [
    "off",
    "valid",
    "missing_identity",
    "missing_schedule",
    "stale_schedule",
    "ambiguous_match",
    "unknown_match",
    "invalid_pairing",
    "incomplete_participants",
  ];
  return {
    id: `obs_${createHash("sha256").update(`${org}:${row.root_id}`).digest("hex")}`,
    event: { id: row.event_id, code: row.event_code, label: row.event_label },
    teamNumber: row.team_number,
    kind: "match" as const,
    match: { id: row.match_id, label, resolved: row.match_id !== null },
    updatedAt: row.extracted_at.toISOString(),
    specificationVersion: row.specification_version,
    values,
    completeness: {
      status: result.status === "complete" ? "complete" : "incomplete",
      missing: specification.fields
        .filter((field) => field.required && values[field.key] === null)
        .map((field) => field.key),
    },
    validation: {
      mode:
        typeof validation.mode === "string" && ["off", "warn", "strict"].includes(validation.mode)
          ? validation.mode
          : "unknown",
      status:
        typeof validation.status === "string" && statuses.includes(validation.status)
          ? validation.status
          : "unknown",
    },
  };
}
