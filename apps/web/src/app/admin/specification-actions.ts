"use server";

import type { ContractIssue, ObservationKind } from "@ai-scouting/scouting";
import general from "@ai-scouting/scouting/examples/general.json" with { type: "json" };
import match from "@ai-scouting/scouting/examples/match.json" with { type: "json" };
import pit from "@ai-scouting/scouting/examples/pit.json" with { type: "json" };
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { backendRequest } from "@/lib/backend";
import {
  type Draft,
  draftPath,
  type EventAssignments,
  type PublicationSummary,
  publicationPath,
  specificationsPath,
} from "@/lib/specifications";

const templates: Record<ObservationKind, { questions: unknown[] }> = { match, pit, general };
const kinds = ["match", "pit", "general"] as const;
const isKind = (value: string): value is ObservationKind =>
  (kinds as readonly string[]).includes(value);
const api = (org: string, path = "") =>
  `/web/organizations/${encodeURIComponent(org)}/specifications${path}`;
const unavailable = "The specification service is unavailable. Try again shortly.";

async function body(response: Response | null) {
  if (!response) return {};
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface CreateSpecificationState {
  status: "idle" | "error";
  message?: string;
  errors: Partial<Record<"season" | "kind" | "name" | "source", string>>;
  values: { season: string; kind: string; name: string; source: string };
}

// Creates a draft and opens it. `source` is blank, template, publication:<season>:<version>
// or draft:<id>. A template is a blank draft saved with the worked example's questions.
export async function createSpecification(
  _previous: CreateSpecificationState,
  form: FormData,
): Promise<CreateSpecificationState> {
  const org = String(form.get("organizationId"));
  const values = {
    season: String(form.get("season") ?? "").trim(),
    kind: String(form.get("kind") ?? ""),
    name: String(form.get("name") ?? "").trim(),
    source: String(form.get("source") ?? "blank"),
  };
  const errors: CreateSpecificationState["errors"] = {};
  const season = Number(values.season);
  if (!/^\d{4}$/.test(values.season) || season < 1992 || season > 2100)
    errors.season = "Enter a season from 1992 to 2100.";
  if (!isKind(values.kind)) errors.kind = "Choose match, pit or general.";
  if (!values.name) errors.name = "Enter a name.";
  else if (values.name.length > 80) errors.name = "Use 80 characters or fewer.";
  if (Object.keys(errors).length) return { status: "error", errors, values };
  const kind = values.kind as ObservationKind;
  const [type, first, second] = values.source.split(":");
  const source =
    type === "publication"
      ? { type, season: Number(first), version: second }
      : type === "draft"
        ? { type, id: first }
        : { type: "blank" };
  const response = await backendRequest(api(org, "/drafts"), {
    method: "POST",
    body: JSON.stringify({ season, kind, name: values.name, source }),
  });
  const data = await body(response);
  if (response?.status !== 201) {
    const fieldErrors = (data.errors ?? {}) as CreateSpecificationState["errors"];
    const known = response && response.status < 500 && Object.keys(fieldErrors).length > 0;
    return {
      status: "error",
      message: known
        ? undefined
        : response?.status === 404
          ? "You no longer administer this team."
          : unavailable,
      errors: known ? fieldErrors : {},
      values,
    };
  }
  const draft = data.draft as Draft;
  if (type === "template") {
    // The draft exists either way; if this save fails the admin lands on the blank draft.
    await backendRequest(api(org, `/drafts/${draft.id}`), {
      method: "PUT",
      body: JSON.stringify({
        revision: draft.revision,
        name: draft.name,
        document: { description: "", questions: templates[kind].questions },
      }),
    });
  }
  revalidatePath(specificationsPath(org));
  redirect(draftPath(org, draft.id));
}

export type SaveDraftResult =
  | { outcome: "saved"; draft: Draft }
  | { outcome: "conflict"; draft: Draft }
  | { outcome: "published"; version: string; message: string }
  | { outcome: "missing" }
  | { outcome: "error"; message: string; errors?: Record<string, string> };

export async function saveSpecificationDraft(
  org: string,
  id: string,
  input: {
    revision: number;
    name: string;
    document: { description: string; questions: unknown[] };
  },
): Promise<SaveDraftResult> {
  const response = await backendRequest(api(org, `/drafts/${encodeURIComponent(id)}`), {
    method: "PUT",
    body: JSON.stringify(input),
  });
  const data = await body(response);
  if (response?.ok) return { outcome: "saved", draft: data.draft as Draft };
  if (response?.status === 409 && typeof data.version === "string")
    return { outcome: "published", version: data.version, message: String(data.error) };
  if (response?.status === 409 && data.draft)
    return { outcome: "conflict", draft: data.draft as Draft };
  if (response?.status === 404 && data.error === "Draft not found.") return { outcome: "missing" };
  if (response?.status === 400)
    return {
      outcome: "error",
      message: "Some details could not be saved. Check the highlighted fields.",
      errors: data.errors as Record<string, string>,
    };
  if (response?.status === 413)
    return { outcome: "error", message: "The specification is too large to save (256 KB)." };
  if (response?.status === 404)
    return { outcome: "error", message: "You no longer administer this team." };
  return {
    outcome: "error",
    message: "Your changes were not saved. They are kept here; try again.",
  };
}

export type PublishDraftResult =
  | { outcome: "published"; publication: PublicationSummary }
  | { outcome: "invalid"; issues: ContractIssue[] }
  | { outcome: "conflict"; draft: Draft }
  | { outcome: "error"; message: string };

export async function publishSpecificationDraft(
  org: string,
  id: string,
  revision: number,
): Promise<PublishDraftResult> {
  const response = await backendRequest(api(org, `/drafts/${encodeURIComponent(id)}/publish`), {
    method: "POST",
    body: JSON.stringify({ revision }),
  });
  const data = await body(response);
  if (response?.ok) {
    revalidatePath(specificationsPath(org));
    return { outcome: "published", publication: data.publication as PublicationSummary };
  }
  if (response?.status === 422)
    return { outcome: "invalid", issues: data.issues as ContractIssue[] };
  if (response?.status === 409 && data.draft)
    return { outcome: "conflict", draft: data.draft as Draft };
  if (response?.status === 404)
    return {
      outcome: "error",
      message: "This draft no longer exists or you no longer administer this team.",
    };
  return { outcome: "error", message: "The specification was not published. Try again shortly." };
}

export interface DraftActionState {
  error?: string;
}

export async function deleteSpecificationDraft(
  _previous: DraftActionState,
  form: FormData,
): Promise<DraftActionState> {
  const org = String(form.get("organizationId"));
  const id = String(form.get("draftId"));
  const response = await backendRequest(api(org, `/drafts/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  const data = await body(response);
  // A draft that is already gone is the outcome the admin asked for.
  if (!response?.ok && !(response?.status === 404 && data.error === "Draft not found."))
    return { error: "The draft was not deleted. Try again shortly." };
  revalidatePath(specificationsPath(org));
  if (form.get("redirect") === "list") redirect(specificationsPath(org));
  return {};
}

export interface AssignState {
  error?: string;
  assignments?: EventAssignments;
}

// Selects the version new sessions of a kind use at one event. An empty version clears pit or general.
export async function assignSpecification(
  _previous: AssignState,
  form: FormData,
): Promise<AssignState> {
  const org = String(form.get("organizationId"));
  const eventId = String(form.get("eventId"));
  const kind = String(form.get("kind"));
  const version = String(form.get("version") ?? "");
  const response = await backendRequest(
    `/web/organizations/${encodeURIComponent(org)}/events/${encodeURIComponent(eventId)}/specifications/${encodeURIComponent(kind)}`,
    { method: "PUT", body: JSON.stringify({ version: version || null }) },
  );
  const data = await body(response);
  if (!response?.ok)
    return {
      error:
        response && response.status < 500 && typeof data.error === "string"
          ? data.error
          : "The event was not changed. Try again shortly.",
    };
  revalidatePath(specificationsPath(org));
  const season = form.get("season");
  if (season && version) revalidatePath(publicationPath(org, Number(season), kind, version));
  return { assignments: (data as { assignments: EventAssignments }).assignments };
}
