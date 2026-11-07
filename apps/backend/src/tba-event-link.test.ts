import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { normalizeFrcEvent } from "./frc-events.ts";
import { discoverTbaEventKey, matchingTbaEventKey } from "./tba-event-link.ts";

const fixture = async (code: string, name: string) =>
  JSON.parse(
    await readFile(new URL(`./fixtures/2026-${code}/${name}.json`, import.meta.url), "utf8"),
  );

test("automatic TBA links use declared FIRST codes across district, championship parents/divisions and Worlds", async () => {
  const codes = ["onosh", "oncmp", "oncmp1", "oncmp2", "archimedes", "cmptx"];
  const listings = await Promise.all(codes.map((code) => fixture(code, "tba-event")));
  for (const code of codes) {
    const event = normalizeFrcEvent(await fixture(code, "event"), 2026, code);
    assert.equal(
      matchingTbaEventKey(event, listings),
      code === "archimedes" ? "2026arc" : `2026${code}`,
    );
  }
});
test("missing, ambiguous, wrong-season, incompatible and non-overlapping listings never produce guesses", async () => {
  const event = normalizeFrcEvent(await fixture("onosh", "event"), 2026, "ONOSH");
  const candidate = await fixture("onosh", "tba-event");
  for (const body of [
    null,
    {},
    [],
    [candidate, candidate],
    [{ ...candidate, first_event_code: null }],
    [{ ...candidate, first_event_code: "ONCMP" }],
    [{ ...candidate, year: 2025 }],
    [{ ...candidate, event_type: null }],
    [{ ...candidate, event_type: 99 }],
    [{ ...candidate, start_date: "2026-11-01", end_date: "2026-11-02" }],
  ])
    assert.equal(matchingTbaEventKey(event, body), null);
});
test("discovery authenticates server-side and provider failures retain usable FIRST configuration", async () => {
  const event = normalizeFrcEvent(await fixture("onosh", "event"), 2026, "ONOSH");
  assert.equal(await discoverTbaEventKey(event, { authorizationKey: "" }), null);
  const key = await discoverTbaEventKey(event, {
    authorizationKey: "test-key",
    fetcher: async (url, options) => {
      assert.equal(String(url), "https://www.thebluealliance.com/api/v3/events/2026");
      assert.equal(new Headers(options?.headers).get("X-TBA-Auth-Key"), "test-key");
      assert.equal(options?.redirect, "error");
      return Response.json([await fixture("onosh", "tba-event")]);
    },
  });
  assert.equal(key, "2026onosh");
  for (const status of [401, 429, 500])
    assert.equal(
      await discoverTbaEventKey(event, {
        authorizationKey: "test-key",
        fetcher: async () => new Response(null, { status }),
      }),
      null,
    );
  assert.equal(
    await discoverTbaEventKey(event, {
      authorizationKey: "test-key",
      fetcher: async () => {
        throw new Error("private-key");
      },
    }),
    null,
  );
  const linked = { ...event, tbaEventKey: "2026manual" };
  assert.equal(
    await discoverTbaEventKey(linked, {
      authorizationKey: "test-key",
      fetcher: async () => {
        throw new Error("must not fetch");
      },
    }),
    "2026manual",
  );
});
