import {
  type Contract,
  draftTestMessagesSchema,
  type ExtractionMessage,
  finalizeTurns,
  LIMITS_DRAFT_TEST,
  type ModelExtraction,
  type ObservationKind,
  observationKinds,
  validateContract,
} from "@ai-scouting/scouting";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { uuidPattern } from "./event-config.ts";
import { DraftTestFailed } from "./mastra-client.ts";
import {
  type AssignResult,
  type CreateDraftResult,
  contractInput,
  type Draft,
  type DraftDocument,
  type DraftSource,
  type DraftSummary,
  draftDocument,
  type EventAssignments,
  MAX_DRAFT_BYTES,
  type Publication,
  type PublicationSummary,
  type PublishResult,
  type SaveDraftResult,
} from "./repositories/specifications.ts";

// Each dependency returns null when the subject is not a linked admin of the team.
export interface SpecificationDeps {
  list(
    org: string,
    subject: string,
    filter: { season?: number; kind?: ObservationKind },
  ): Promise<{ drafts: DraftSummary[]; publications: PublicationSummary[] } | null>;
  publication(
    org: string,
    subject: string,
    season: number,
    kind: ObservationKind,
    version: string,
  ): Promise<Publication | "not_found" | null>;
  create(
    org: string,
    subject: string,
    input: { season: number; kind: ObservationKind; name: string; source: DraftSource },
  ): Promise<CreateDraftResult | null>;
  load(org: string, subject: string, id: string): Promise<Draft | "not_found" | null>;
  save(
    org: string,
    subject: string,
    id: string,
    input: { revision: number; name: string; document: DraftDocument },
  ): Promise<SaveDraftResult | null>;
  remove(org: string, subject: string, id: string): Promise<boolean | null>;
  publish(
    org: string,
    subject: string,
    id: string,
    revision: number,
  ): Promise<PublishResult | null>;
  events(org: string, subject: string): Promise<EventAssignments[] | null>;
  assignments(
    org: string,
    subject: string,
    eventId: string,
  ): Promise<EventAssignments | "not_found" | null>;
  assign(
    org: string,
    subject: string,
    eventId: string,
    kind: ObservationKind,
    version: string | null,
  ): Promise<AssignResult | null>;
  // Model extraction for draft and publication tests (#49). Null when Mastra is not configured.
  draftTest?:
    | ((contract: Contract, messages: ExtractionMessage[]) => Promise<ModelExtraction>)
    | null;
  // Model calls each team may start per window. Defaults to 20 per 10 minutes.
  draftTestLimit?: { count: number; windowMs: number };
}

// In-memory and per process: enough to stop runaway clicks, not a billing control.
function draftTestLimiter({ count, windowMs }: { count: number; windowMs: number }) {
  const starts = new Map<string, number[]>();
  const running = new Set<string>();
  return {
    // `key` names the draft or publication under test; one run of each at a time.
    begin(org: string, key: string, now = Date.now()): "ok" | "busy" | "limited" {
      if (running.has(key)) return "busy";
      const recent = (starts.get(org) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= count) {
        starts.set(org, recent);
        return "limited";
      }
      starts.set(org, [...recent, now]);
      running.add(key);
      return "ok";
    },
    end(key: string) {
      running.delete(key);
    },
  };
}

const draftTestFailures: Record<DraftTestFailed["reason"], [string, 502 | 503 | 504]> = {
  unavailable: [
    "The extraction service is unavailable. Your sample is kept; try again in a minute.",
    503,
  ],
  timeout: [
    "The extraction service took too long to answer. Your sample is kept; try again, or shorten the sample.",
    504,
  ],
  invalid: [
    "The extraction service returned an answer we could not use. Try again; if it repeats, simplify the sample.",
    502,
  ],
};

const unavailable = { error: "Organization unavailable" };
const draftMissing = { error: "Draft not found." };
const isKind = (value: unknown): value is ObservationKind =>
  typeof value === "string" && (observationKinds as readonly string[]).includes(value);
const isSeason = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1992 && value <= 2100;
const isRevision = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const record = (input: unknown): Record<string, unknown> =>
  input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
const nameError = (value: unknown) =>
  typeof value !== "string" || !value.trim() || value.trim().length > 80 || /\p{Cc}/u.test(value)
    ? "Enter a name using 80 characters or fewer."
    : null;

function source(value: unknown): DraftSource | null {
  const input = record(value);
  if (input.type === undefined || input.type === "blank") return { type: "blank" };
  if (
    input.type === "publication" &&
    isSeason(input.season) &&
    typeof input.version === "string" &&
    versionPattern.test(input.version)
  )
    return { type: "publication", season: input.season, version: input.version };
  if (input.type === "draft" && typeof input.id === "string" && uuidPattern.test(input.id))
    return { type: "draft", id: input.id };
  return null;
}

const assignmentErrors: Record<
  Exclude<AssignResult["outcome"], "assigned">,
  [string, 404 | 422]
> = {
  event_not_found: ["Event not found.", 404],
  publication_not_found: ["Publication not found.", 404],
  season_mismatch: ["This publication belongs to another season than the event.", 422],
  required: ["Match scouting always needs a specification.", 422],
};

// Mounted inside the web admin routes, after the session check sets `subject`.
// A team the account does not administer gets the same 404 as one that does not exist.
export function specificationRoutes(deps: SpecificationDeps) {
  const app = new Hono<{ Variables: { subject: string } }>();
  const base = "/organizations/:id/specifications";
  const drafts = `${base}/drafts`;
  const limit = bodyLimit({
    maxSize: MAX_DRAFT_BYTES,
    onError: (c) => c.json({ error: "The specification is too large." }, 413),
  });
  // Each wildcard also matches its list path.
  for (const path of [`${base}/*`, "/organizations/:id/events/:eventId/specifications/*"])
    app.use(path, async (c, next) => {
      if (!uuidPattern.test(c.req.param("id") ?? "")) return c.json(unavailable, 404);
      await next();
    });
  const json = async (request: Request) => record(await request.json().catch(() => null));

  app.get(base, async (c) => {
    const season = c.req.query("season");
    const kind = c.req.query("kind");
    const filter: { season?: number; kind?: ObservationKind } = {};
    if (season !== undefined) {
      if (!isSeason(Number(season))) return c.json({ error: "Season is not valid." }, 400);
      filter.season = Number(season);
    }
    if (kind !== undefined) {
      if (!isKind(kind)) return c.json({ error: "Kind is not valid." }, 400);
      filter.kind = kind;
    }
    const result = await deps.list(c.req.param("id"), c.get("subject"), filter);
    return result ? c.json(result) : c.json(unavailable, 404);
  });

  app.get(`${base}/publications/:season/:kind/:version`, async (c) => {
    const season = Number(c.req.param("season"));
    const kind = c.req.param("kind");
    const version = c.req.param("version");
    if (!isSeason(season) || !isKind(kind) || !versionPattern.test(version))
      return c.json({ error: "Publication not found." }, 404);
    const result = await deps.publication(
      c.req.param("id"),
      c.get("subject"),
      season,
      kind,
      version,
    );
    if (result === null) return c.json(unavailable, 404);
    if (result === "not_found") return c.json({ error: "Publication not found." }, 404);
    return c.json({ publication: result });
  });

  app.get(`${base}/events`, async (c) => {
    const result = await deps.events(c.req.param("id"), c.get("subject"));
    return result ? c.json({ events: result }) : c.json(unavailable, 404);
  });

  app.post(drafts, limit, async (c) => {
    const body = await json(c.req.raw);
    const errors: Record<string, string> = {};
    if (!isSeason(body.season)) errors.season = "Enter a season from 1992 to 2100.";
    if (!isKind(body.kind)) errors.kind = "Choose match, pit or general.";
    const name = nameError(body.name);
    if (name) errors.name = name;
    const from = source(body.source);
    if (!from) errors.source = "Choose a blank draft, a publication or a draft to copy.";
    if (Object.keys(errors).length || !from) return c.json({ errors }, 400);
    const result = await deps.create(c.req.param("id"), c.get("subject"), {
      season: body.season as number,
      kind: body.kind as ObservationKind,
      name: (body.name as string).trim(),
      source: from,
    });
    if (!result) return c.json(unavailable, 404);
    if (result.outcome === "source_not_found")
      return c.json({ errors: { source: "The copy source was not found for this kind." } }, 404);
    return c.json({ draft: result.draft }, 201);
  });

  const draftId = (id: string | undefined) => (id && uuidPattern.test(id) ? id : null);

  app.get(`${drafts}/:draftId`, async (c) => {
    const id = draftId(c.req.param("draftId"));
    if (!id) return c.json(draftMissing, 404);
    const result = await deps.load(c.req.param("id"), c.get("subject"), id);
    if (result === null) return c.json(unavailable, 404);
    if (result === "not_found") return c.json(draftMissing, 404);
    return c.json({ draft: result });
  });

  app.put(`${drafts}/:draftId`, limit, async (c) => {
    const id = draftId(c.req.param("draftId"));
    if (!id) return c.json(draftMissing, 404);
    const body = await json(c.req.raw);
    const errors: Record<string, string> = {};
    if (!isRevision(body.revision)) errors.revision = "Reload the draft and try again.";
    const name = nameError(body.name);
    if (name) errors.name = name;
    const document = record(body.document);
    if (typeof document.description !== "string" || !Array.isArray(document.questions))
      errors.document = "Send the description and the list of questions.";
    if (Object.keys(errors).length) return c.json({ errors }, 400);
    const result = await deps.save(c.req.param("id"), c.get("subject"), id, {
      revision: body.revision as number,
      name: (body.name as string).trim(),
      document: draftDocument(document),
    });
    if (!result) return c.json(unavailable, 404);
    if (result.outcome === "not_found") return c.json(draftMissing, 404);
    if (result.outcome === "published")
      return c.json(
        {
          error: `This draft was published as ${result.version}. Create a new draft to make changes.`,
          version: result.version,
        },
        409,
      );
    if (result.outcome === "conflict")
      return c.json(
        {
          error: "Someone else saved this draft. Your changes were not saved.",
          draft: result.draft,
        },
        409,
      );
    return c.json({ draft: result.draft });
  });

  app.delete(`${drafts}/:draftId`, async (c) => {
    const id = draftId(c.req.param("draftId"));
    if (!id) return c.json(draftMissing, 404);
    const result = await deps.remove(c.req.param("id"), c.get("subject"), id);
    if (result === null) return c.json(unavailable, 404);
    return result ? c.json({ deleted: true }) : c.json(draftMissing, 404);
  });

  app.post(`${drafts}/:draftId/publish`, async (c) => {
    const id = draftId(c.req.param("draftId"));
    if (!id) return c.json(draftMissing, 404);
    const body = await json(c.req.raw);
    if (!isRevision(body.revision))
      return c.json({ errors: { revision: "Reload the draft and try again." } }, 400);
    const result = await deps.publish(c.req.param("id"), c.get("subject"), id, body.revision);
    if (!result) return c.json(unavailable, 404);
    if (result.outcome === "not_found") return c.json(draftMissing, 404);
    if (result.outcome === "conflict")
      return c.json(
        {
          error: "The draft changed since you loaded it. Review it, then publish again.",
          draft: result.draft,
        },
        409,
      );
    if (result.outcome === "invalid")
      return c.json(
        { error: "Fix the listed problems before publishing.", issues: result.issues },
        422,
      );
    return c.json(
      { publication: result.publication, replayed: result.replayed },
      result.replayed ? 200 : 201,
    );
  });

  // Extraction tests (#49). Run the production extraction on synthetic messages against a saved
  // draft revision or a published version. Nothing is stored and no message is sent.
  const limiter = draftTestLimiter(deps.draftTestLimit ?? { count: 20, windowMs: 10 * 60_000 });
  const testLimit = bodyLimit({
    maxSize: 32 * 1024,
    onError: (c) => c.json({ error: "The sample is too large." }, 413),
  });
  const sampleMessages = (value: unknown) => {
    const messages = draftTestMessagesSchema.safeParse(value);
    if (messages.success) return { messages: messages.data };
    return {
      error:
        messages.error.issues.find((i) => i.code === "custom")?.message ??
        `Enter a note, and up to ${LIMITS_DRAFT_TEST.messages - 1} replies of ${LIMITS_DRAFT_TEST.text} characters or fewer.`,
    };
  };
  // Starts one model call for `key` once the caller is authorized and the contract is valid.
  const runTest = async (
    org: string,
    key: string,
    contract: Contract,
    messages: ExtractionMessage[],
    // "this draft" or "this version", for the busy message.
    subject: string,
  ): Promise<
    | { ok: true; result: ReturnType<typeof finalizeTurns> }
    | { ok: false; error: string; status: 429 | 502 | 503 | 504 }
  > => {
    if (!deps.draftTest)
      return { ok: false, error: "Extraction testing is not set up on this server.", status: 503 };
    const started = limiter.begin(org, key);
    if (started === "busy")
      return {
        ok: false,
        error: `A test of ${subject} is already running. Wait for it to finish.`,
        status: 429,
      };
    if (started === "limited")
      return {
        ok: false,
        error:
          "Your team has run many tests in the last few minutes. Wait a few minutes, then try again.",
        status: 429,
      };
    try {
      const extracted = await deps.draftTest(contract, messages);
      return { ok: true, result: finalizeTurns(contract, extracted.turns) };
    } catch (error) {
      const [message, status] =
        draftTestFailures[error instanceof DraftTestFailed ? error.reason : "unavailable"];
      return { ok: false, error: message, status };
    } finally {
      limiter.end(key);
    }
  };

  app.post(`${drafts}/:draftId/test`, testLimit, async (c) => {
    const id = draftId(c.req.param("draftId"));
    if (!id) return c.json(draftMissing, 404);
    const body = await json(c.req.raw);
    if (!isRevision(body.revision))
      return c.json({ errors: { revision: "Reload the draft and try again." } }, 400);
    const sample = sampleMessages(body.messages);
    if (!sample.messages) return c.json({ errors: { messages: sample.error } }, 400);
    const org = c.req.param("id");
    // Authorization comes first: a non-admin never reaches the model or the limiter.
    const draft = await deps.load(org, c.get("subject"), id);
    if (draft === null) return c.json(unavailable, 404);
    if (draft === "not_found") return c.json(draftMissing, 404);
    if (draft.revision !== body.revision)
      return c.json(
        {
          error: "The draft changed since this test started. Save it, then run the test again.",
          revision: draft.revision,
        },
        409,
      );
    const version = `draft-r${draft.revision}`;
    const validation = validateContract(
      contractInput(draft.kind, draft.document, version),
      draft.kind,
    );
    if (!validation.ok)
      return c.json(
        { error: "Fix the listed problems before testing extraction.", issues: validation.issues },
        422,
      );
    const run = await runTest(org, id, validation.contract, sample.messages, "this draft");
    if (!run.ok) return c.json({ error: run.error }, run.status);
    return c.json({ test: { revision: draft.revision, result: run.result } });
  });

  // The stored contract was validated when it was published and is read back as sessions read it.
  app.post(`${base}/publications/:season/:kind/:version/test`, testLimit, async (c) => {
    const season = Number(c.req.param("season"));
    const kind = c.req.param("kind");
    const version = c.req.param("version");
    if (!isSeason(season) || !isKind(kind) || !versionPattern.test(version))
      return c.json({ error: "Publication not found." }, 404);
    const body = await json(c.req.raw);
    const sample = sampleMessages(body.messages);
    if (!sample.messages) return c.json({ errors: { messages: sample.error } }, 400);
    const org = c.req.param("id");
    const publication = await deps.publication(org, c.get("subject"), season, kind, version);
    if (publication === null) return c.json(unavailable, 404);
    if (publication === "not_found") return c.json({ error: "Publication not found." }, 404);
    const run = await runTest(
      org,
      `publication:${season}:${kind}:${version}`,
      publication.contract,
      sample.messages,
      "this version",
    );
    if (!run.ok) return c.json({ error: run.error }, run.status);
    return c.json({ test: { version, result: run.result } });
  });

  const eventPath = "/organizations/:id/events/:eventId/specifications";
  app.get(eventPath, async (c) => {
    const eventId = c.req.param("eventId");
    if (!uuidPattern.test(eventId)) return c.json({ error: "Event not found." }, 404);
    const result = await deps.assignments(c.req.param("id"), c.get("subject"), eventId);
    if (result === null) return c.json(unavailable, 404);
    if (result === "not_found") return c.json({ error: "Event not found." }, 404);
    return c.json({ assignments: result });
  });

  app.put(`${eventPath}/:kind`, async (c) => {
    const eventId = c.req.param("eventId");
    const kind = c.req.param("kind");
    if (!uuidPattern.test(eventId)) return c.json({ error: "Event not found." }, 404);
    if (!isKind(kind)) return c.json({ error: "Kind is not valid." }, 404);
    const body = await json(c.req.raw);
    const version = body.version;
    if (version !== null && (typeof version !== "string" || !versionPattern.test(version)))
      return c.json(
        { errors: { version: "Choose a published version, or null to clear it." } },
        400,
      );
    const result = await deps.assign(c.req.param("id"), c.get("subject"), eventId, kind, version);
    if (!result) return c.json(unavailable, 404);
    if (result.outcome !== "assigned") {
      const [error, status] = assignmentErrors[result.outcome];
      return c.json({ error, outcome: result.outcome }, status);
    }
    return c.json({ assignments: result.assignments });
  });
  return app;
}
