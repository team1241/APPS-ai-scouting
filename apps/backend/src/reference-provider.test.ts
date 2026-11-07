import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { normalizeFrcEvent } from "./frc-events.ts";
import { firstPlayoffIdentity } from "./playoff-identity.ts";
import {
  frcProvider,
  normalizeFrcSchedule,
  normalizeFrcTeams,
  normalizeTbaMatches,
} from "./reference-provider.ts";

const fixture = async (name: string) =>
  JSON.parse(
    await readFile(new URL(`./fixtures/2026-onham1/${name}.json`, import.meta.url), "utf8"),
  );
test("actual 2026 offseason roster and qualification/playoff identities remain distinct", async () => {
  assert.equal(normalizeFrcTeams(await fixture("teams")).teams.length, 6);
  const q = normalizeFrcSchedule(await fixture("qualification"), "Qualification");
  const p = normalizeFrcSchedule(await fixture("playoff"), "Playoff");
  assert.equal(q[0]?.key, "qm:1");
  assert.equal(p[0]?.key, "first:playoff:1");
  assert.equal(p[0]?.round, "R1");
  assert.equal(p[13]?.round, "final");
  assert.equal(p[0]?.participants[0]?.number, 7558);
  const broken = await fixture("qualification");
  broken.Schedule[0].teams.pop();
  assert.throws(() => normalizeFrcSchedule(broken, "Qualification"));
});
test("FIRST adapter paginates roster and merges results without treating scheduled time as completion", async () => {
  process.env.FRC_EVENTS_USERNAME = "fixture";
  process.env.FRC_EVENTS_AUTHORIZATION_KEY = "fixture";
  const data = await frcProvider((async (url) => {
    const u = String(url);
    if (u.includes("/events?")) return Response.json({ Events: [await fixture("event")] });
    const name = u.includes("/teams")
      ? "teams"
      : u.includes("/matches")
        ? "results"
        : u.includes("=Qualification")
          ? "qualification"
          : "playoff";
    return Response.json(await fixture(name));
  }) as typeof fetch).load(2026, "onham1");
  assert.equal(data.teams.length, 6);
  assert.ok(data.matches.length > 6);
  assert.equal(data.matches[0]?.actual, "2026-10-31T08:45:50.63");
  assert.equal(data.matches[0]?.completed, "2026-10-31T08:50:13.907");
});
test("TBA full playoff set/round identity, qualification identity and completion", () => {
  const match = {
    key: "2026test_sf2m1",
    event_key: "2026test",
    comp_level: "sf",
    set_number: 2,
    match_number: 1,
    time: 100,
    actual_time: null,
    predicted_time: 110,
    post_result_time: null,
    alliances: {
      red: { team_keys: ["frc1", "frc2", "frc3"], surrogate_team_keys: [], score: -1 },
      blue: { team_keys: ["frc4", "frc5", "frc6"], surrogate_team_keys: [], score: -1 },
    },
  };
  const m = normalizeTbaMatches([match], "2026test")[0];
  assert.equal(m?.key, "tba:sf:2:1");
  assert.equal(m?.completed, null);
  assert.throws(() => normalizeTbaMatches([match], "2026other"));
});

const formatFixture = async (code: string, name: string) =>
  JSON.parse(
    await readFile(
      new URL(`./fixtures/2026-${code.toLowerCase()}/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
for (const [code, type, playoffCount, hasQualifications, tbaKey] of [
  ["ONOSH", "DistrictEvent", 16, true, "2026onosh"],
  ["ONCMP1", "DistrictChampionshipDivision", 16, true, "2026oncmp1"],
  ["ONCMP2", "DistrictChampionshipDivision", 16, true, "2026oncmp2"],
  ["ONCMP", "DistrictChampionshipWithLevels", 3, false, "2026oncmp"],
  ["ARCHIMEDES", "ChampionshipDivision", 16, true, "2026arc"],
  ["CMPTX", "Championship", 16, false, "2026cmptx"],
] as const) {
  test(`${code}: actual FIRST/TBA format, qualifications, playoff mapping and participants`, async () => {
    const event = await formatFixture(code, "event");
    assert.equal(event.type, type);
    assert.equal(normalizeFrcEvent(event, 2026, code).type, "official");
    const qualifications = normalizeFrcSchedule(
      await formatFixture(code, "qualification"),
      "Qualification",
    );
    assert.equal(qualifications.length > 0, hasQualifications);
    const playoffs = normalizeFrcSchedule(await formatFixture(code, "playoff"), "Playoff");
    assert.equal(playoffs.length, playoffCount);
    const tbaEvent = await formatFixture(code, "tba-event");
    const tba = normalizeTbaMatches(await formatFixture(code, "tba-matches"), tbaKey);
    for (const match of tba.filter((m) => m.stage === "playoff")) {
      const identity = firstPlayoffIdentity(match, 2026, event.type, tbaEvent.playoff_type);
      const first = playoffs.find((m) => m.key === identity);
      assert.ok(first, match.key);
      assert.deepEqual(
        first.participants.map((p) => p.number).sort((a, b) => a - b),
        match.participants.map((p) => p.number).sort((a, b) => a - b),
        match.key,
      );
    }
    const firstPlayoff = tba.find((m) => m.stage === "playoff");
    assert.ok(firstPlayoff);
    assert.equal(firstPlayoffIdentity(firstPlayoff, 2025, event.type, tbaEvent.playoff_type), null);
    assert.equal(firstPlayoffIdentity(firstPlayoff, 2026, event.type, 999), null);
    if (code === "ONCMP" || code === "CMPTX")
      assert.deepEqual(await formatFixture(code, "results"), { Matches: [] });
  });
}
test("championship division references are explicit and do not assume equal provider codes", async () => {
  const ontario = await formatFixture("ONCMP", "tba-event");
  assert.deepEqual(ontario.division_keys, ["2026oncmp1", "2026oncmp2"]);
  const worlds = await formatFixture("ARCHIMEDES", "tba-event");
  assert.equal(worlds.parent_event_key, "2026cmptx");
  assert.equal(worlds.key, "2026arc");
  assert.equal((await formatFixture("ARCHIMEDES", "event")).code, "ARCHIMEDES");
});
