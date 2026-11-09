import assert from "node:assert/strict";
import { test } from "node:test";
import { requirements } from "@ai-scouting/scouting";
import { dataApiRoutes } from "./data-api.ts";
import { exportObservation, InvalidPage, pageResult, readPage } from "./scouting-data.ts";

const org = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";

test("pagination binds cursors to tenant, event and team and bounds request sizes", () => {
  const scope = { organizationId: org, eventId, teamNumber: 1241 };
  const page = { limit: 1, after: null };
  const result = pageResult([{ id: org }, { id: other }], page, scope, (r) => r.id);
  const cursor = result.nextCursor as string;
  assert.equal(readPage({ cursor }, scope).after, org);
  for (const changed of [
    { ...scope, organizationId: other },
    { ...scope, eventId: other },
    { ...scope, teamNumber: 1 },
    { organizationId: org },
  ])
    assert.throws(() => readPage({ cursor }, changed), InvalidPage);
  for (const limit of ["0", "101", "1.2", "1e2", "-1", "", " 2"])
    assert.throws(() => readPage({ limit }, scope), InvalidPage);
  for (const cursor of ["", "garbage", "A".repeat(1025)])
    assert.throws(() => readPage({ cursor }, scope), InvalidPage);
  assert.throws(() => readPage({ organizationId: other }, scope), InvalidPage);
});

test("observation exports preserve false/null and exclude private extraction and validation fields", () => {
  const row = {
    root_id: org,
    event_id: eventId,
    event_code: "ONOSH",
    event_label: "Ontario Oshawa",
    team_number: 1241,
    match_id: null,
    match_label: "Q1",
    match_stage: null,
    match_number: null,
    specification_version: requirements.version,
    extracted_at: new Date("2026-11-09T00:00:00Z"),
    document: requirements,
    extraction_result: {
      status: "needs_review",
      values: {
        match: "Q1",
        team_number: 1241,
        climbed: false,
        notes: null,
        scout_identity: "SECRET",
      },
      question: "SECRET",
    },
    validation_result: {
      mode: "warn",
      status: "missing_schedule",
      conflictSessionId: "SECRET",
      message: "SECRET",
    },
  };
  const output = exportObservation(org, row);
  assert.deepEqual(output.event, { id: eventId, code: "ONOSH", label: "Ontario Oshawa" });
  assert.equal(Object.hasOwn(output, "eventId"), false);
  assert.equal(Object.hasOwn(output, "eventCode"), false);
  for (const match_label of ["1", "q1", "qm1", "QM:1", "qualification match 1", " Q001 "]) {
    const normalized = exportObservation(org, { ...row, match_label });
    assert.equal(normalized.match.label, "Q1");
    assert.equal(normalized.values.match, "Q1");
    assert.equal(normalized.match.resolved, false);
  }
  const resolved = exportObservation(org, {
    ...row,
    match_id: other,
    match_stage: "qualification",
    match_number: 42,
  });
  assert.equal(resolved.match.label, "Q42");
  assert.equal(resolved.values.match, "Q42");
  assert.equal(resolved.match.resolved, true);
  for (const match_label of ["P1", "sf1m2", null])
    assert.equal(exportObservation(org, { ...row, match_label }).match.label, match_label);
  assert.equal(exportObservation(org, { ...row, event_code: null }).event.code, null);
  assert.equal(output.values.climbed, false);
  assert.equal(output.values.notes, null);
  assert.equal(output.match.resolved, false);
  assert.equal(output.completeness.status, "incomplete");
  assert.ok(!JSON.stringify(output).includes("SECRET"));
  assert.notEqual(exportObservation(other, row).id, output.id);
  assert.equal(exportObservation(org, { ...row, extracted_at: new Date() }).id, output.id);
});

test("scouting routes validate scope and consistently return private JSON", async () => {
  const calls: unknown[] = [];
  const app = dataApiRoutes({
    verify: async () => ({ valid: true, keyId: "key", organizationId: org }),
    active: async () => true,
    organization: async () => undefined,
    scouting: {
      events: async (scope, page) => {
        calls.push([scope, page]);
        return { data: [], nextCursor: null };
      },
      observations: async (scope, page) => {
        calls.push([scope, page]);
        return scope.eventId === other ? null : { data: [], nextCursor: null };
      },
      specification: async (id, event) => {
        calls.push([id, event]);
        return null;
      },
    },
  });
  const get = (url: string, method = "GET") =>
    app.request(url, { method, headers: { authorization: "Bearer scout_test" } });
  const contract = await get("/openapi.json");
  assert.equal(contract.status, 200);
  assert.equal(((await contract.json()) as { openapi: string }).openapi, "3.1.0");
  assert.equal((await get("/teams/1241/events")).status, 200);
  assert.equal((await get(`/events/${eventId}/teams/1241/observations?limit=2`)).status, 200);
  assert.deepEqual(calls.at(-1), [
    { organizationId: org, eventId, teamNumber: 1241 },
    { limit: 2, after: null },
  ]);
  assert.equal((await get(`/events/${eventId}/observations`)).status, 200);
  assert.equal((await get(`/events/${other}/observations`)).status, 404);
  for (const path of [
    "/teams/0/events",
    "/teams/1e2/events",
    "/events/bad/observations",
    `/events/${eventId}/observations?limit=101`,
    `/events/${eventId}/observations?organizationId=${other}`,
  ]) {
    const response = await get(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal((await get(`/events/${other}/specifications/v1`)).status, 404);
  assert.equal((await get(`/events/${eventId}/observations`, "POST")).status, 404);
});
