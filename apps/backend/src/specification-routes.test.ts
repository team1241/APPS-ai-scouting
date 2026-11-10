import assert from "node:assert/strict";
import { test } from "node:test";
import type { Draft } from "./repositories/specifications.ts";
import type { SpecificationDeps } from "./specification-routes.ts";
import { webAdminRoutes } from "./web-admin.ts";

const org = "00000000-0000-4000-8000-000000000046";
const otherOrg = "00000000-0000-4000-8000-000000000047";
const draftId = "00000000-0000-4000-8000-000000000048";
const eventId = "00000000-0000-4000-8000-000000000049";
const headers = { authorization: "Bearer session", "content-type": "application/json" };
const send = (method: string, value: unknown) => ({ method, headers, body: JSON.stringify(value) });

const draft: Draft = {
  id: draftId,
  season: 2027,
  kind: "match",
  name: "Match 2027",
  revision: 1,
  source: null,
  updatedAt: "2026-11-09T00:00:00.000Z",
  document: { description: "", questions: [] },
  issues: [],
};
const admin = (subject: string, id: string) => subject === "user_admin" && id === org;

function deps(overrides: Partial<SpecificationDeps> = {}): SpecificationDeps {
  return {
    list: async (id, subject) => (admin(subject, id) ? { drafts: [], publications: [] } : null),
    publication: async (id, subject) => (admin(subject, id) ? "not_found" : null),
    create: async (id, subject) => (admin(subject, id) ? { outcome: "created", draft } : null),
    load: async (id, subject) => (admin(subject, id) ? draft : null),
    save: async (id, subject, _draft, input) =>
      admin(subject, id)
        ? { outcome: "saved", draft: { ...draft, revision: input.revision + 1 } }
        : null,
    remove: async (id, subject) => (admin(subject, id) ? true : null),
    publish: async (id, subject) =>
      admin(subject, id)
        ? {
            outcome: "published",
            replayed: false,
            publication: {
              season: 2027,
              kind: "match",
              version: "v1",
              name: "Match 2027",
              formatVersion: 2,
              publishedAt: "2026-11-09T00:00:00.000Z",
              assignedEventIds: [],
            },
          }
        : null,
    events: async (id, subject) => (admin(subject, id) ? [] : null),
    assignments: async (id, subject) => (admin(subject, id) ? "not_found" : null),
    assign: async (id, subject) => (admin(subject, id) ? { outcome: "event_not_found" } : null),
    ...overrides,
  };
}

function app(overrides: Partial<SpecificationDeps> = {}, subject = "user_admin") {
  return webAdminRoutes({
    verify: async () => subject,
    organizations: async () => [],
    claim: null,
    specifications: deps(overrides),
  });
}

test("specification routes require a session and hide teams the account does not administer", async () => {
  const signedOut = webAdminRoutes({
    verify: async () => null,
    organizations: async () => [],
    claim: null,
    specifications: deps(),
  });
  assert.equal((await signedOut.request(`/organizations/${org}/specifications`)).status, 401);
  for (const path of [
    `/organizations/${otherOrg}/specifications`,
    `/organizations/${otherOrg}/specifications/drafts/${draftId}`,
    `/organizations/${otherOrg}/events/${eventId}/specifications`,
    "/organizations/not-a-uuid/specifications",
  ]) {
    const response = await app().request(path, { headers });
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: "Organization unavailable" });
  }
  const outsider = await app({}, "user_other").request(`/organizations/${org}/specifications`, {
    headers,
  });
  assert.equal(outsider.status, 404);
});

test("draft creation validates season, kind, name and source", async () => {
  const response = await app().request(
    `/organizations/${org}/specifications/drafts`,
    send("POST", { season: 1900, kind: "scrimmage", name: " ", source: { type: "other" } }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(Object.keys((await response.json()).errors).sort(), [
    "kind",
    "name",
    "season",
    "source",
  ]);
  let received: unknown;
  const created = await app({
    create: async (_org, _subject, input) => {
      received = input;
      return { outcome: "created", draft };
    },
  }).request(
    `/organizations/${org}/specifications/drafts`,
    send("POST", {
      season: 2027,
      kind: "pit",
      name: " Pit 2027 ",
      source: { type: "publication", season: 2026, version: "v2" },
    }),
  );
  assert.equal(created.status, 201);
  assert.deepEqual(received, {
    season: 2027,
    kind: "pit",
    name: "Pit 2027",
    source: { type: "publication", season: 2026, version: "v2" },
  });
  const missing = await app({ create: async () => ({ outcome: "source_not_found" }) }).request(
    `/organizations/${org}/specifications/drafts`,
    send("POST", {
      season: 2027,
      kind: "pit",
      name: "Copy",
      source: { type: "draft", id: draftId },
    }),
  );
  assert.equal(missing.status, 404);
});

test("saves send only author content and return the stored draft on a stale revision", async () => {
  let received: unknown;
  const ok = await app({
    save: async (_org, _subject, _id, input) => {
      received = input;
      return { outcome: "saved", draft: { ...draft, revision: 2 } };
    },
  }).request(
    `/organizations/${org}/specifications/drafts/${draftId}`,
    send("PUT", {
      revision: 1,
      name: "Match",
      document: { description: "d", questions: [{ key: "x" }], kind: "pit", formatVersion: 9 },
    }),
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(received, {
    revision: 1,
    name: "Match",
    document: { description: "d", questions: [{ key: "x" }] },
  });
  const stale = await app({
    save: async () => ({ outcome: "conflict", draft: { ...draft, revision: 3 } }),
  }).request(
    `/organizations/${org}/specifications/drafts/${draftId}`,
    send("PUT", { revision: 1, name: "Match", document: { description: "", questions: [] } }),
  );
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).draft.revision, 3);
  const published = await app({
    save: async () => ({ outcome: "published", version: "v4" }),
  }).request(
    `/organizations/${org}/specifications/drafts/${draftId}`,
    send("PUT", { revision: 1, name: "Match", document: { description: "", questions: [] } }),
  );
  assert.equal(published.status, 409);
  assert.equal((await published.json()).version, "v4");
  const malformed = await app().request(
    `/organizations/${org}/specifications/drafts/${draftId}`,
    send("PUT", { revision: 0, name: "Match", document: { questions: "no" } }),
  );
  assert.equal(malformed.status, 400);
  const tooLarge = await app().request(
    `/organizations/${org}/specifications/drafts/${draftId}`,
    send("PUT", {
      revision: 1,
      name: "Match",
      document: { description: "x".repeat(300_000), questions: [] },
    }),
  );
  assert.equal(tooLarge.status, 413);
});

test("publication reports invalid contracts and replays retries", async () => {
  const invalid = await app({
    publish: async () => ({
      outcome: "invalid",
      issues: [{ code: "cycle", path: ["questions", 2, "rules"], question: "a", message: "cycle" }],
    }),
  }).request(
    `/organizations/${org}/specifications/drafts/${draftId}/publish`,
    send("POST", { revision: 2 }),
  );
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).issues[0].code, "cycle");
  const first = await app().request(
    `/organizations/${org}/specifications/drafts/${draftId}/publish`,
    send("POST", { revision: 2 }),
  );
  assert.equal(first.status, 201);
  const replay = await app({
    publish: async () => ({
      outcome: "published",
      replayed: true,
      publication: {
        season: 2027,
        kind: "match",
        version: "v1",
        name: null,
        formatVersion: 2,
        publishedAt: "2026-11-09T00:00:00.000Z",
        assignedEventIds: [],
      },
    }),
  }).request(
    `/organizations/${org}/specifications/drafts/${draftId}/publish`,
    send("POST", { revision: 2 }),
  );
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
});

test("assignment validates kind and version and explains refusals", async () => {
  const path = `/organizations/${org}/events/${eventId}/specifications`;
  assert.equal(
    (await app().request(`${path}/scrimmage`, send("PUT", { version: "v1" }))).status,
    404,
  );
  assert.equal((await app().request(`${path}/pit`, send("PUT", { version: "../x" }))).status, 400);
  let received: unknown;
  const cleared = await app({
    assign: async (_org, _subject, _event, kind, version) => {
      received = [kind, version];
      return {
        outcome: "assigned",
        assignments: {
          event: { id: eventId, name: "Event", season: 2027 },
          match: { version: "starter-match-v1" },
          pit: null,
          general: null,
        },
      };
    },
  }).request(`${path}/pit`, send("PUT", { version: null }));
  assert.equal(cleared.status, 200);
  assert.deepEqual(received, ["pit", null]);
  for (const [outcome, status] of [
    ["season_mismatch", 422],
    ["unsupported_by_intake", 422],
    ["required", 422],
    ["publication_not_found", 404],
  ] as const) {
    const response = await app({ assign: async () => ({ outcome }) }).request(
      `${path}/match`,
      send("PUT", { version: "v1" }),
    );
    assert.equal(response.status, status, outcome);
    assert.equal((await response.json()).outcome, outcome);
  }
});

test("event list returns every current event with its assignments", async () => {
  const path = `/organizations/${org}/specifications/events`;
  const events = [
    {
      event: { id: eventId, name: "Event", season: 2027, startDate: "2027-03-01" },
      match: { version: "starter-match-v1" },
      pit: { version: "v2" },
      general: null,
    },
  ];
  const listed = await app({ events: async () => events }).request(path, { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { events });
  assert.equal((await app({}, "user_other").request(path, { headers })).status, 404);
  assert.equal(
    (await app().request("/organizations/not-a-team/specifications/events", { headers })).status,
    404,
  );
});
