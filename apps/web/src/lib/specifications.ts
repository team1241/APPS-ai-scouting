import type { Contract, ContractIssue, ObservationKind } from "@ai-scouting/scouting";

// Shapes returned by the backend specification API (#46).

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
  document: { description: string; questions: unknown[] };
  issues: ContractIssue[];
}

export interface PublicationSummary {
  season: number;
  kind: ObservationKind;
  version: string;
  name: string | null;
  formatVersion: number | null;
  publishedAt: string;
  assignedEventIds: string[];
}

export interface Publication extends PublicationSummary {
  contract: Contract;
}

export interface EventAssignments {
  event: { id: string; name: string; season: number; startDate?: string };
  match: { version: string };
  pit: { version: string } | null;
  general: { version: string } | null;
}

export const observationKindOrder: ObservationKind[] = ["match", "pit", "general"];

// Versions are server-assigned v1, v2, ... per team, season and kind.
export function nextVersion(publications: PublicationSummary[], season: number, kind: string) {
  const numbers = publications
    .filter((p) => p.season === season && p.kind === kind)
    .map((p) => /^v(\d+)$/.exec(p.version)?.[1])
    .filter(Boolean)
    .map(Number);
  return `v${Math.max(0, ...numbers) + 1}`;
}

export const specificationsPath = (org: string) => `/admin/${org}/specifications`;
export const draftPath = (org: string, id: string) =>
  `${specificationsPath(org)}/drafts/${encodeURIComponent(id)}`;
export const publicationPath = (org: string, season: number, kind: string, version: string) =>
  `${specificationsPath(org)}/publications/${season}/${kind}/${encodeURIComponent(version)}`;

export const dateTimeFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});
export const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

// The FRC season that new work most likely targets: next year's from September.
export function defaultSeason(now = new Date()) {
  return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
}
