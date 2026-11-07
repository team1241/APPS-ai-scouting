import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  frcAcquisitionProvider,
  frcRosterProvider,
  frcScheduleProvider,
  tbaAcquisitionProvider,
  tbaScheduleProvider,
} from "./reference-provider.ts";

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

test("combined FIRST acquisition paginates the roster and never requests results", async () => {
  process.env.FRC_EVENTS_USERNAME = "fixture";
  process.env.FRC_EVENTS_AUTHORIZATION_KEY = "fixture";
  const calls: string[] = [];
  const snapshot = await frcAcquisitionProvider(async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/events?")) return Response.json({ Events: [await fixture("onosh", "event")] });
    if (u.includes("/schedule/")) return Response.json(await fixture("onosh", "qualification"));
    assert.ok(u.includes("/teams?"));
    const body = await fixture("onosh", "teams");
    const page = Number(new URL(u).searchParams.get("page"));
    return Response.json({
      ...body,
      pageCurrent: page,
      pageTotal: 2,
      teamCountTotal: 12,
      teams: body.teams.map((team: { teamNumber: number }) => ({
        ...team,
        teamNumber: team.teamNumber + (page === 2 ? 10000 : 0),
      })),
    });
  }).load(2026, "ONOSH");
  assert.equal(snapshot.teams.length, 12);
  assert.equal(snapshot.matches.length, 2);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((u) => !u.includes("/matches/")));
});
test("roster-only FIRST backfill performs no schedule requests and rejects missing pages", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      frcRosterProvider(async (url) => {
        calls++;
        assert.ok(String(url).includes("/teams?"));
        const body = await fixture("onosh", "teams");
        return Response.json({ ...body, pageCurrent: 1, pageTotal: 2, teamCountTotal: 12 });
      }).load(2026, "ONOSH"),
    /Unstable roster pagination/,
  );
  assert.equal(calls, 2);
});
test("combined TBA acquisition saves roster details with the schedule", async () => {
  process.env.TBA_AUTH_KEY = "fixture";
  const snapshot = await tbaAcquisitionProvider(async (url) => {
    const u = String(url);
    if (u.endsWith("/matches/simple")) return Response.json(await fixture("onosh", "tba-matches"));
    if (u.endsWith("/teams"))
      return Response.json([
        {
          team_number: 1241,
          nickname: "THEORY6",
          city: "Mississauga",
          state_prov: "Ontario",
          country: "Canada",
        },
      ]);
    return Response.json(await fixture("onosh", "tba-event"));
  }).load(2026, "2026onosh");
  assert.equal(snapshot.teams[0]?.name, "THEORY6");
  assert.equal(snapshot.matches.length, 2);
});
