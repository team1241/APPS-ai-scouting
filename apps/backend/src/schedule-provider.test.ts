import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { frcScheduleProvider, tbaScheduleProvider } from "./reference-provider.ts";

const fixture = async (code: string, name: string) =>
  JSON.parse(
    await readFile(new URL(`./fixtures/2026-${code}/${name}.json`, import.meta.url), "utf8"),
  );
test("automatic FIRST import fetches qualification schedule without roster, results or playoffs", async () => {
  process.env.FRC_EVENTS_USERNAME = "fixture";
  process.env.FRC_EVENTS_AUTHORIZATION_KEY = "fixture";
  const urls: string[] = [];
  const snapshot = await frcScheduleProvider(async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/events?")) return Response.json({ Events: [await fixture("onosh", "event")] });
    assert.ok(u.endsWith("/schedule/ONOSH?tournamentLevel=Qualification"));
    return Response.json(await fixture("onosh", "qualification"));
  }).load(2026, "ONOSH");
  assert.equal(snapshot.teams.length, 0);
  assert.equal(snapshot.matches.length, 2);
  assert.equal(urls.length, 2);
  assert.ok(snapshot.matches.every((m) => m.result === null && m.completed === null));
});
test("finals-only championship parents use playoffs when qualifications are empty", async () => {
  const snapshot = await frcScheduleProvider(async (url) => {
    const u = String(url);
    if (u.includes("/events?")) return Response.json({ Events: [await fixture("oncmp", "event")] });
    return Response.json(
      await fixture("oncmp", u.includes("=Qualification") ? "qualification" : "playoff"),
    );
  }).load(2026, "ONCMP");
  assert.equal(snapshot.matches.length, 3);
  assert.ok(snapshot.matches.every((m) => m.stage === "playoff"));
});
test("TBA fallback only requests metadata and simple matches and excludes result data", async () => {
  process.env.TBA_AUTH_KEY = "fixture";
  const urls: string[] = [];
  const snapshot = await tbaScheduleProvider(async (url) => {
    const u = String(url);
    urls.push(u);
    return Response.json(
      await fixture("onosh", u.endsWith("/matches/simple") ? "tba-matches" : "tba-event"),
    );
  }).load(2026, "2026onosh");
  assert.equal(urls.length, 2);
  assert.ok(urls[1]?.endsWith("/matches/simple"));
  assert.equal(snapshot.matches.length, 2);
  assert.ok(
    snapshot.matches.every(
      (m) => m.stage === "qualification" && m.result === null && m.completed === null,
    ),
  );
});
