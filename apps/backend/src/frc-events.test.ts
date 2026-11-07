import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "./fixtures/frc-event.json" with { type: "json" };
import {
  FrcEventsError,
  lookupFrcEvent,
  normalizeFrcEvent,
  parseFrcReference,
} from "./frc-events.ts";

test("FIRST lookup authenticates server-side, normalizes codes, Windows timezone and local dates", async () => {
  const result = await lookupFrcEvent(2020, "cthar", {
    username: "tester",
    authorizationKey: "private-key",
    fetcher: async (url, options) => {
      assert.equal(
        String(url),
        "https://frc-api.firstinspires.org/v3.0/2020/events?eventCode=CTHAR",
      );
      assert.equal(
        options?.headers && new Headers(options.headers).get("authorization"),
        `Basic ${Buffer.from("tester:private-key").toString("base64")}`,
      );
      assert.equal(options?.redirect, "error");
      return Response.json(fixture);
    },
  });
  assert.equal(result.name, fixture.Events[0]?.name);
  assert.equal(result.frcEventCode, "CTHAR");
  assert.equal(result.timezone, "America/New_York");
  assert.equal(result.startDate, "2020-04-03");
  assert.equal(result.endDate, "2020-04-05");
  assert.equal(result.source, "frc_events");
  assert.equal(result.type, "official");
  assert.equal(
    normalizeFrcEvent(
      { ...fixture.Events[0], type: "OffSeasonWithAzureSync", timezone: "America/Toronto" },
      2020,
      "CTHAR",
    ).type,
    "offseason",
  );
});

test("invalid references and incomplete or mismatched provider data cannot become active events", () => {
  for (const [season, code] of [
    ["2014", "CTHAR"],
    ["2020", "../bad"],
    [String(new Date().getUTCFullYear() + 1), "CTHAR"],
  ])
    assert.throws(() => parseFrcReference(season ?? "", code ?? ""), FrcEventsError);
  for (const patch of [
    { code: "OTHER" },
    { timezone: null },
    { dateStart: null },
    { type: "Unknown" },
    { name: null },
  ])
    assert.throws(
      () => normalizeFrcEvent({ ...fixture.Events[0], ...patch }, 2020, "CTHAR"),
      FrcEventsError,
    );
});

test("provider errors are actionable and do not expose credentials", async () => {
  for (const [status, body] of [
    [401, {}],
    [404, {}],
    [429, {}],
    [500, {}],
    [200, { Events: [] }],
    [200, { Events: [fixture.Events[0], fixture.Events[0]] }],
    [200, { unexpected: true }],
  ] as const) {
    await assert.rejects(
      lookupFrcEvent(2020, "CTHAR", {
        username: "tester",
        authorizationKey: "do-not-leak",
        fetcher: async () => Response.json(body, { status }),
      }),
      (error) => error instanceof FrcEventsError && !error.message.includes("do-not-leak"),
    );
  }
  await assert.rejects(
    lookupFrcEvent(2020, "CTHAR", {
      username: "tester",
      authorizationKey: "do-not-leak",
      fetcher: async () => {
        throw Error("network failure");
      },
    }),
    /could not be reached/,
  );
  await assert.rejects(
    lookupFrcEvent(2020, "CTHAR", { username: "", authorizationKey: "" }),
    /credentials are not configured/,
  );
});
