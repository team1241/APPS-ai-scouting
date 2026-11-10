import {
  CONTRACT_FORMAT_VERSION,
  type Contract,
  type ContractIssue,
  contractFormat,
  type ObservationKind,
  readContract,
  requirements,
  validateContract,
} from "@ai-scouting/scouting";
import { sql, type Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import { lockEventContext } from "./events.ts";
import { withTenant } from "./tenant.ts";
import { webAdminMember } from "./web-admin.ts";

// Scouting specification drafts, publication and event assignment (#46).
// Every operation rechecks that the Clerk subject is a linked adult admin of the team.

export const MAX_DRAFT_BYTES = 256 * 1024;

export interface DraftDocument {
  description: string;
  questions: unknown[];
}

export interface DraftSummary {
  id: string;
  season: number;
  kind: ObservationKind;
  name: string;
  revision: number;
  source: { season: number; version: string } | null;
  updatedAt: string;
}

export interface Draft extends DraftSummary {
  document: DraftDocument;
  // Shown on every load and save. Saving never requires a valid contract.
  issues: ContractIssue[];
}

export interface PublicationSummary {
  season: number;
  kind: ObservationKind;
  version: string;
  name: string | null;
  formatVersion: number | null;
  publishedAt: string;
  // Events whose new sessions use this publication.
  assignedEventIds: string[];
}

export interface Publication extends PublicationSummary {
  // Normalized to the current contract format for read-only display.
  contract: Contract;
}

export type DraftSource =
  | { type: "blank" }
  | { type: "publication"; season: number; version: string }
  | { type: "draft"; id: string };

export type CreateDraftResult =
  | { outcome: "created"; draft: Draft }
  | { outcome: "source_not_found" };
export type SaveDraftResult =
  | { outcome: "saved"; draft: Draft }
  | { outcome: "conflict"; draft: Draft }
  | { outcome: "published"; version: string }
  | { outcome: "not_found" };
export type PublishResult =
  | { outcome: "published"; publication: PublicationSummary; replayed: boolean }
  | { outcome: "invalid"; issues: ContractIssue[] }
  | { outcome: "conflict"; draft: Draft }
  | { outcome: "not_found" };
export type AssignResult =
  | { outcome: "assigned"; assignments: EventAssignments }
  | {
      outcome: "event_not_found" | "publication_not_found" | "season_mismatch" | "required";
    };

export interface EventAssignments {
  event: { id: string; name: string; season: number; startDate?: string };
  // Match always has a publication: the event's existing specification selection.
  match: { version: string };
  pit: { version: string } | null;
  general: { version: string } | null;
}

const iso = (value: Date | string) => new Date(value).toISOString();
const record = (input: unknown): Record<string, unknown> =>
  input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

// Keep only author-controlled content. Format, kind and version come from the server.
export function draftDocument(input: unknown): DraftDocument {
  const value = record(input);
  return {
    description: typeof value.description === "string" ? value.description : "",
    questions: Array.isArray(value.questions) ? value.questions : [],
  };
}

export const contractInput = (kind: ObservationKind, document: DraftDocument, version: string) => ({
  formatVersion: CONTRACT_FORMAT_VERSION,
  kind,
  version,
  description: document.description,
  questions: document.questions,
});

export function draftIssues(kind: ObservationKind, document: DraftDocument): ContractIssue[] {
  const result = validateContract(contractInput(kind, document, "draft"), kind);
  return result.ok ? [] : result.issues;
}

// Starting content for a new contract: the protected identity questions for the kind.
export function blankDraft(kind: ObservationKind): DraftDocument {
  const legacy = readContract(requirements);
  const identity = (key: "match" | "team_number", required: boolean) => {
    const question = legacy.questions.find((q) => q.key === key);
    return question ? { ...question, required } : null;
  };
  const questions =
    kind === "match"
      ? [identity("match", true), identity("team_number", true)]
      : [identity("team_number", kind === "pit")];
  return { description: "", questions: questions.filter(Boolean) };
}

type DraftRow = {
  id: string;
  season: number;
  kind: string;
  name: string;
  revision: number;
  source_season: number | null;
  source_version: string | null;
  updated_at: Date | string;
  document: unknown;
};
const draftColumns = [
  "id",
  "season",
  "kind",
  "name",
  "revision",
  "source_season",
  "source_version",
  "updated_at",
  "document",
] as const;

function summary(row: DraftRow): DraftSummary {
  return {
    id: row.id,
    season: row.season,
    kind: row.kind as ObservationKind,
    name: row.name,
    revision: row.revision,
    source:
      row.source_season !== null && row.source_version !== null
        ? { season: row.source_season, version: row.source_version }
        : null,
    updatedAt: iso(row.updated_at),
  };
}

function draft(row: DraftRow): Draft {
  const document = draftDocument(row.document);
  return { ...summary(row), document, issues: draftIssues(row.kind as ObservationKind, document) };
}

function openDraft(tx: Transaction<DB>, org: string, id: string, lock = false) {
  const query = tx
    .selectFrom("specification_draft")
    .select([...draftColumns, "published_version"])
    .where("organization_id", "=", org)
    .where("id", "=", id);
  return (lock ? query.forUpdate() : query).executeTakeFirst();
}

async function assignedEvents(tx: Transaction<DB>, org: string) {
  const [match, other] = await Promise.all([
    tx
      .selectFrom("event")
      .select(["id", "season", "specification_version as version"])
      .where("organization_id", "=", org)
      .where("archived", "=", false)
      .execute(),
    tx
      .selectFrom("event_specification_assignment as a")
      .innerJoin("event as e", (join) =>
        join.onRef("e.organization_id", "=", "a.organization_id").onRef("e.id", "=", "a.event_id"),
      )
      .select(["a.event_id as id", "a.season", "a.kind", "a.version"])
      .where("a.organization_id", "=", org)
      .where("e.archived", "=", false)
      .execute(),
  ]);
  const map = new Map<string, string[]>();
  const add = (key: string, id: string) => map.set(key, [...(map.get(key) ?? []), id]);
  for (const row of match) add(`${row.season}:match:${row.version}`, row.id);
  for (const row of other) add(`${row.season}:${row.kind}:${row.version}`, row.id);
  return map;
}

export function listSpecifications(
  org: string,
  subject: string,
  filter: { season?: number; kind?: ObservationKind } = {},
) {
  return withTenant(org, async (tx) => {
    if (!(await webAdminMember(tx, org, subject))) return null;
    let drafts = tx
      .selectFrom("specification_draft")
      .select(draftColumns)
      .where("organization_id", "=", org)
      .where("published_version", "is", null);
    let publications = tx
      .selectFrom("published_specification")
      .select(["season", "kind", "version", "name", "published_at", "document"])
      .where("organization_id", "=", org);
    if (filter.season !== undefined) {
      drafts = drafts.where("season", "=", filter.season);
      publications = publications.where("season", "=", filter.season);
    }
    if (filter.kind) {
      drafts = drafts.where("kind", "=", filter.kind);
      publications = publications.where("kind", "=", filter.kind);
    }
    const [draftRows, publicationRows, assigned] = await Promise.all([
      drafts.orderBy("updated_at", "desc").execute(),
      publications.orderBy("published_at", "desc").orderBy("version").execute(),
      assignedEvents(tx, org),
    ]);
    return {
      drafts: draftRows.map(summary),
      publications: publicationRows.map(
        (row): PublicationSummary => ({
          season: row.season,
          kind: row.kind as ObservationKind,
          version: row.version,
          name: row.name,
          formatVersion: contractFormat(row.document),
          publishedAt: iso(row.published_at),
          assignedEventIds: assigned.get(`${row.season}:${row.kind}:${row.version}`) ?? [],
        }),
      ),
    };
  });
}

export function readPublication(
  org: string,
  subject: string,
  season: number,
  kind: ObservationKind,
  version: string,
) {
  return withTenant(org, async (tx): Promise<Publication | "not_found" | null> => {
    if (!(await webAdminMember(tx, org, subject))) return null;
    const row = await tx
      .selectFrom("published_specification")
      .select(["season", "kind", "version", "name", "published_at", "document"])
      .where("organization_id", "=", org)
      .where("season", "=", season)
      .where("kind", "=", kind)
      .where("version", "=", version)
      .executeTakeFirst();
    if (!row) return "not_found";
    const assigned = await assignedEvents(tx, org);
    return {
      season: row.season,
      kind,
      version: row.version,
      name: row.name,
      formatVersion: contractFormat(row.document),
      publishedAt: iso(row.published_at),
      assignedEventIds: assigned.get(`${row.season}:${kind}:${row.version}`) ?? [],
      contract: readContract(row.document, kind),
    };
  });
}

export function createDraft(
  org: string,
  subject: string,
  input: { season: number; kind: ObservationKind; name: string; source: DraftSource },
) {
  return withTenant(org, async (tx): Promise<CreateDraftResult | null> => {
    const admin = await webAdminMember(tx, org, subject);
    if (!admin) return null;
    let document: DraftDocument;
    let source: { season: number; version: string } | null = null;
    if (input.source.type === "blank") document = blankDraft(input.kind);
    else if (input.source.type === "publication") {
      const row = await tx
        .selectFrom("published_specification")
        .select("document")
        .where("organization_id", "=", org)
        .where("season", "=", input.source.season)
        .where("kind", "=", input.kind)
        .where("version", "=", input.source.version)
        .executeTakeFirst();
      if (!row) return { outcome: "source_not_found" };
      // Format 1 publications upgrade to the current format in the copy only.
      const contract = readContract(row.document, input.kind);
      document = { description: contract.description, questions: contract.questions };
      source = { season: input.source.season, version: input.source.version };
    } else {
      const row = await openDraft(tx, org, input.source.id);
      if (!row || row.kind !== input.kind) return { outcome: "source_not_found" };
      document = draftDocument(row.document);
      source =
        row.source_season !== null && row.source_version !== null
          ? { season: row.source_season, version: row.source_version }
          : null;
    }
    const row = await tx
      .insertInto("specification_draft")
      .values({
        organization_id: org,
        season: input.season,
        kind: input.kind,
        name: input.name,
        document: JSON.stringify(document),
        source_season: source?.season ?? null,
        source_version: source?.version ?? null,
        created_by: admin.id,
        updated_by: admin.id,
      })
      .returning(draftColumns)
      .executeTakeFirstOrThrow();
    return { outcome: "created", draft: draft(row) };
  });
}

export function loadDraft(org: string, subject: string, id: string) {
  return withTenant(org, async (tx): Promise<Draft | "not_found" | null> => {
    if (!(await webAdminMember(tx, org, subject))) return null;
    const row = await openDraft(tx, org, id);
    return row && row.published_version === null ? draft(row) : "not_found";
  });
}

// Saves only when `revision` is still current. On conflict the stored draft comes back
// unchanged, so the editor can keep the author's edits and offer a merge.
export function saveDraft(
  org: string,
  subject: string,
  id: string,
  input: { revision: number; name: string; document: DraftDocument },
) {
  return withTenant(org, async (tx): Promise<SaveDraftResult | null> => {
    const admin = await webAdminMember(tx, org, subject);
    if (!admin) return null;
    const row = await openDraft(tx, org, id, true);
    if (!row) return { outcome: "not_found" };
    if (row.published_version !== null)
      return { outcome: "published", version: row.published_version };
    if (row.revision !== input.revision) return { outcome: "conflict", draft: draft(row) };
    const saved = await tx
      .updateTable("specification_draft")
      .set({
        name: input.name,
        document: JSON.stringify(input.document),
        revision: row.revision + 1,
        updated_by: admin.id,
        updated_at: sql`now()`,
      })
      .where("organization_id", "=", org)
      .where("id", "=", id)
      .returning(draftColumns)
      .executeTakeFirstOrThrow();
    return { outcome: "saved", draft: draft(saved) };
  });
}

export function deleteDraft(org: string, subject: string, id: string) {
  return withTenant(org, async (tx): Promise<boolean | null> => {
    if (!(await webAdminMember(tx, org, subject))) return null;
    const deleted = await tx
      .deleteFrom("specification_draft")
      .where("organization_id", "=", org)
      .where("id", "=", id)
      .where("published_version", "is", null)
      .executeTakeFirst();
    return deleted.numDeletedRows === 1n;
  });
}

// Next server-assigned version for the season and kind: v1, v2, ...
async function nextVersion(tx: Transaction<DB>, org: string, season: number, kind: string) {
  const rows = await tx
    .selectFrom("published_specification")
    .select("version")
    .where("organization_id", "=", org)
    .where("season", "=", season)
    .where("kind", "=", kind)
    .execute();
  const numbers = rows
    .map((r) => /^v(\d+)$/.exec(r.version)?.[1])
    .filter(Boolean)
    .map(Number);
  return `v${Math.max(0, ...numbers) + 1}`;
}

// Publishes one immutable version from a draft. The draft row lock makes a retry of the
// same draft return the version it already created instead of a second version.
export function publishDraft(org: string, subject: string, id: string, revision: number) {
  return withTenant(org, async (tx): Promise<PublishResult | null> => {
    const admin = await webAdminMember(tx, org, subject);
    if (!admin) return null;
    const row = await openDraft(tx, org, id, true);
    if (!row) return { outcome: "not_found" };
    const kind = row.kind as ObservationKind;
    if (row.published_version !== null) {
      const published = await tx
        .selectFrom("published_specification")
        .select(["name", "published_at", "document"])
        .where("organization_id", "=", org)
        .where("season", "=", row.season)
        .where("kind", "=", kind)
        .where("version", "=", row.published_version)
        .executeTakeFirstOrThrow();
      const assigned = await assignedEvents(tx, org);
      return {
        outcome: "published",
        replayed: true,
        publication: {
          season: row.season,
          kind,
          version: row.published_version,
          name: published.name,
          formatVersion: contractFormat(published.document),
          publishedAt: iso(published.published_at),
          assignedEventIds: assigned.get(`${row.season}:${kind}:${row.published_version}`) ?? [],
        },
      };
    }
    if (row.revision !== revision) return { outcome: "conflict", draft: draft(row) };
    // Serializes version numbering for the team, season and kind.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${org}:${row.season}:${kind}:publish`}, 0))`.execute(
      tx,
    );
    const version = await nextVersion(tx, org, row.season, kind);
    const document = draftDocument(row.document);
    const result = validateContract(contractInput(kind, document, version), kind);
    if (!result.ok) return { outcome: "invalid", issues: result.issues };
    const published = await tx
      .insertInto("published_specification")
      .values({
        organization_id: org,
        season: row.season,
        kind,
        version,
        name: row.name,
        document: JSON.stringify(result.contract),
        published_by: admin.id,
        source_draft_id: row.id,
      })
      .returning(["published_at"])
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("specification_draft")
      .set({ published_version: version, published_at: published.published_at })
      .where("organization_id", "=", org)
      .where("id", "=", row.id)
      .execute();
    return {
      outcome: "published",
      replayed: false,
      publication: {
        season: row.season,
        kind,
        version,
        name: row.name,
        formatVersion: CONTRACT_FORMAT_VERSION,
        publishedAt: iso(published.published_at),
        assignedEventIds: [],
      },
    };
  });
}

async function eventAssignments(
  tx: Transaction<DB>,
  org: string,
  eventId: string,
): Promise<EventAssignments | null> {
  const event = await tx
    .selectFrom("event")
    .select(["id", "name", "season", "specification_version"])
    .where("organization_id", "=", org)
    .where("id", "=", eventId)
    .where("archived", "=", false)
    .executeTakeFirst();
  if (!event) return null;
  const rows = await tx
    .selectFrom("event_specification_assignment")
    .select(["kind", "version"])
    .where("organization_id", "=", org)
    .where("event_id", "=", eventId)
    .execute();
  const other = (kind: string) => {
    const row = rows.find((r) => r.kind === kind);
    return row ? { version: row.version } : null;
  };
  return {
    event: { id: event.id, name: event.name, season: event.season },
    match: { version: event.specification_version },
    pit: other("pit"),
    general: other("general"),
  };
}

// Every current event of the team with its assignments, newest first, for the builder.
export function listEventAssignments(org: string, subject: string) {
  return withTenant(org, async (tx): Promise<EventAssignments[] | null> => {
    if (!(await webAdminMember(tx, org, subject))) return null;
    const [events, rows] = await Promise.all([
      tx
        .selectFrom("event")
        .select(["id", "name", "season", "start_date", "specification_version"])
        .where("organization_id", "=", org)
        .where("archived", "=", false)
        .orderBy("start_date", "desc")
        .orderBy("name")
        .execute(),
      tx
        .selectFrom("event_specification_assignment")
        .select(["event_id", "kind", "version"])
        .where("organization_id", "=", org)
        .execute(),
    ]);
    const other = (eventId: string, kind: string) => {
      const row = rows.find((r) => r.event_id === eventId && r.kind === kind);
      return row ? { version: row.version } : null;
    };
    return events.map((event) => ({
      event: {
        id: event.id,
        name: event.name,
        season: event.season,
        startDate: iso(event.start_date).slice(0, 10),
      },
      match: { version: event.specification_version },
      pit: other(event.id, "pit"),
      general: other(event.id, "general"),
    }));
  });
}

export function readEventAssignments(org: string, subject: string, eventId: string) {
  return withTenant(org, async (tx): Promise<EventAssignments | "not_found" | null> => {
    if (!(await webAdminMember(tx, org, subject))) return null;
    return (await eventAssignments(tx, org, eventId)) ?? "not_found";
  });
}

// Selects the publication new sessions of a kind use at an event. Open sessions keep the
// publication pinned at intake, and recorded observations are never re-extracted.
export function assignSpecification(
  org: string,
  subject: string,
  eventId: string,
  kind: ObservationKind,
  version: string | null,
) {
  return withTenant(org, async (tx): Promise<AssignResult | null> => {
    const admin = await webAdminMember(tx, org, subject);
    if (!admin) return null;
    // Same lock as event activation and intake binding.
    await lockEventContext(tx, org);
    const event = await tx
      .selectFrom("event")
      .select(["id", "season", "specification_version"])
      .where("organization_id", "=", org)
      .where("id", "=", eventId)
      .where("archived", "=", false)
      .forUpdate()
      .executeTakeFirst();
    if (!event) return { outcome: "event_not_found" };
    if (version === null) {
      if (kind === "match") return { outcome: "required" };
      await tx
        .deleteFrom("event_specification_assignment")
        .where("organization_id", "=", org)
        .where("event_id", "=", eventId)
        .where("kind", "=", kind)
        .execute();
    } else {
      const publications = await tx
        .selectFrom("published_specification")
        .select(["season", "document"])
        .where("organization_id", "=", org)
        .where("kind", "=", kind)
        .where("version", "=", version)
        .execute();
      const publication = publications.find((p) => p.season === event.season);
      if (!publication)
        return { outcome: publications.length ? "season_mismatch" : "publication_not_found" };
      if (kind === "match") {
        await tx
          .updateTable("event")
          .set({ specification_version: version })
          .where("organization_id", "=", org)
          .where("id", "=", eventId)
          .execute();
      } else {
        await tx
          .insertInto("event_specification_assignment")
          .values({
            organization_id: org,
            event_id: eventId,
            kind,
            season: event.season,
            version,
            assigned_by: admin.id,
          })
          .onConflict((oc) =>
            oc.columns(["organization_id", "event_id", "kind"]).doUpdateSet({
              version,
              assigned_by: admin.id,
              assigned_at: sql`now()`,
            }),
          )
          .execute();
      }
    }
    const assignments = await eventAssignments(tx, org, eventId);
    if (!assignments) return { outcome: "event_not_found" };
    return { outcome: "assigned", assignments };
  });
}
