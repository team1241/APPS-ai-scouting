import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { sql } from "kysely";
import { db } from "./db.ts";
import { normalizeFrcEvent } from "./frc-events.ts";
import {
  normalizeFrcSchedule,
  normalizeFrcTeams,
  type ReferenceProvider,
  type Snapshot,
} from "./reference-provider.ts";
import { changeEvent } from "./repositories/events.ts";
import { enrollMember } from "./repositories/members.ts";
import { syncReference } from "./repositories/reference.ts";
import { withTenant } from "./repositories/tenant.ts";
import { runScheduleJob } from "./schedule-job.ts";

after(() => db.destroy());
const fixture = async (name: string) =>
  JSON.parse(
    await readFile(new URL(`./fixtures/2026-onosh/${name}.json`, import.meta.url), "utf8"),
  );
async function setup(org: string, tba = false) {
  for (const [user, role] of [
    ["1", "admin"],
    ["2", "admin"],
    ["3", "scout"],
  ] as const)
    await enrollMember({
      organizationId: org,
      organizationName: "Schedule tests",
      frcTeamNumber: 1241,
      memberName: user,
      role,
      channel: "telegram",
      externalUserId: user,
    });
  const config = normalizeFrcEvent(await fixture("event"), 2026, "ONOSH");
  const result = await changeEvent(
    org,
    "1",
    "create",
    { kind: "import-frc", config: { ...config, tbaEventKey: tba ? "2026onosh" : null } },
    async () => null,
  );
  assert.ok(result.eventId);
  return result.eventId;
}
async function cleanup(org: string) {
  await withTenant(org, async (tx) => {
    await tx.deleteFrom("event_command").where("organization_id", "=", org).execute();
    await tx.deleteFrom("event").where("organization_id", "=", org).execute();
    await tx.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
    await tx.deleteFrom("member").where("organization_id", "=", org).execute();
    await tx.deleteFrom("organization").where("id", "=", org).execute();
  });
}
const at = (minute: number) => new Date(Date.parse("2026-03-13T22:00:00Z") + minute * 60000);
test("all added events poll from 6pm, retry every ten minutes, stop durably after save and notify only admins", async () => {
  const org = randomUUID(),
    other = randomUUID();
  try {
    const id = await setup(org);
    await setup(other);
    const metadata = await fixture("event");
    const matches = normalizeFrcSchedule(await fixture("qualification"), "Qualification");
    let calls = 0;
    let phase: "empty" | "partial" | "ready" = "empty";
    const first: ReferenceProvider = {
      source: "frc_events",
      load: async () => {
        calls++;
        return {
          teams: normalizeFrcTeams(await fixture("teams")).teams,
          matches: phase === "empty" ? [] : matches,
          complete: phase !== "partial",
          eventFacts: metadata,
        };
      },
    };
    const providers = {
      first,
      tba: {
        source: "tba" as const,
        load: async (): Promise<Snapshot> => {
          throw new Error("not linked");
        },
      },
    };
    const sends: string[] = [];
    let secondRateLimited = false;
    const fetcher: typeof fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      sends.push(body.chat_id);
      assert.match(body.text, /received and saved/);
      if (body.chat_id === "2" && !secondRateLimited) {
        secondRateLimited = true;
        return Response.json(
          { ok: false, error_code: 429, parameters: { retry_after: 600 } },
          { status: 429 },
        );
      }
      return Response.json({ ok: true, result: { message_id: 1 } });
    };
    await runScheduleJob(org, "test-bot", { now: at(-1), providers, fetcher });
    assert.equal(calls, 0);
    const firstRuns = await Promise.all([
      runScheduleJob(org, "test-bot", { now: at(0), providers, fetcher }),
      runScheduleJob(org, "test-bot", { now: at(0), providers, fetcher }),
    ]);
    assert.equal(
      firstRuns.reduce((n, r) => n + r.attempted, 0),
      1,
    );
    assert.equal(calls, 1);
    assert.equal(sends.length, 0);
    await runScheduleJob(org, "test-bot", { now: at(9), providers, fetcher });
    assert.equal(calls, 1);
    phase = "partial";
    await runScheduleJob(org, "test-bot", { now: at(10), providers, fetcher });
    assert.equal(calls, 2);
    assert.equal(sends.length, 0);
    phase = "ready";
    await Promise.all([
      runScheduleJob(org, "test-bot", { now: at(20), providers, fetcher }),
      runScheduleJob(org, "test-bot", { now: at(20), providers, fetcher }),
    ]);
    assert.equal(calls, 3);
    assert.deepEqual(sends.sort(), ["1", "2"]);
    const poll = await withTenant(org, (tx) =>
      tx
        .selectFrom("schedule_poll")
        .selectAll()
        .where("organization_id", "=", org)
        .where("event_id", "=", id)
        .executeTakeFirstOrThrow(),
    );
    assert.equal(poll.status, "received");
    assert.ok(poll.received_at);
    const cached = await withTenant(org, (tx) =>
      tx
        .selectFrom("event_match")
        .select("id")
        .where("organization_id", "=", org)
        .where("event_id", "=", id)
        .execute(),
    );
    assert.equal(cached.length, 2);
    await runScheduleJob(org, "test-bot", { now: at(30), providers, fetcher });
    assert.equal(calls, 3);
    assert.equal(sends.length, 3);
    await runScheduleJob(org, "test-bot", { now: at(1440), providers, fetcher });
    assert.equal(calls, 3);
    assert.equal(sends.length, 3);
    const notifications = await withTenant(org, (tx) =>
      tx
        .selectFrom("schedule_notification")
        .selectAll()
        .where("organization_id", "=", org)
        .execute(),
    );
    assert.equal(notifications.length, 2);
    assert.ok(notifications.every((n) => n.status === "sent"));
  } finally {
    await cleanup(org);
    await cleanup(other);
  }
});
test("FIRST failure falls back to linked TBA; notification timeout never restarts polling or silently resends", async () => {
  const org = randomUUID();
  try {
    await setup(org, true);
    let calls = 0;
    const matches = normalizeFrcSchedule(await fixture("qualification"), "Qualification");
    const providers = {
      first: {
        source: "frc_events" as const,
        load: async (): Promise<Snapshot> => {
          calls++;
          throw new Error("FIRST unavailable");
        },
      },
      tba: {
        source: "tba" as const,
        load: async () => {
          calls++;
          return {
            teams: normalizeFrcTeams(await fixture("teams")).teams,
            matches,
            complete: true,
          };
        },
      },
    };
    let sends = 0;
    const fetcher: typeof fetch = async () => {
      sends++;
      throw new Error("Telegram timeout");
    };
    const result = await runScheduleJob(org, "test-bot", { now: at(0), providers, fetcher });
    assert.equal(result.received, 1);
    assert.equal(calls, 2);
    assert.equal(sends, 2);
    await runScheduleJob(org, "test-bot", { now: at(10), providers, fetcher });
    assert.equal(calls, 2);
    assert.equal(sends, 2);
    const notifications = await withTenant(org, (tx) =>
      tx
        .selectFrom("schedule_notification")
        .select("status")
        .where("organization_id", "=", org)
        .execute(),
    );
    assert.ok(notifications.every((n) => n.status === "uncertain"));
  } finally {
    await cleanup(org);
  }
});

test("failed schedule persistence cannot stop polling or queue a notification", async () => {
  const org = randomUUID();
  try {
    const id = await setup(org);
    const matches = normalizeFrcSchedule(await fixture("qualification"), "Qualification");
    const broken = structuredClone(matches);
    assert.ok(broken[0]?.participants[0]);
    broken[0].participants[0].station = "Invalid";
    let valid = false;
    let sends = 0;
    const providers = {
      first: {
        source: "frc_events" as const,
        load: async () => ({
          teams: normalizeFrcTeams(await fixture("teams")).teams,
          matches: valid ? matches : broken,
          complete: true,
        }),
      },
      tba: {
        source: "tba" as const,
        load: async (): Promise<Snapshot> => {
          throw new Error("not linked");
        },
      },
    };
    const fetcher: typeof fetch = async () => {
      sends++;
      return Response.json({ ok: true });
    };
    await assert.rejects(
      () => runScheduleJob(org, "test-bot", { now: at(0), providers, fetcher }),
      /check constraint/,
    );
    const state = await withTenant(org, async (tx) => ({
      poll: await tx
        .selectFrom("schedule_poll")
        .selectAll()
        .where("organization_id", "=", org)
        .where("event_id", "=", id)
        .executeTakeFirstOrThrow(),
      matches: await tx
        .selectFrom("event_match")
        .select("id")
        .where("organization_id", "=", org)
        .execute(),
      notifications: await tx
        .selectFrom("schedule_notification")
        .select("status")
        .where("organization_id", "=", org)
        .execute(),
    }));
    assert.equal(state.poll.received_at, null);
    assert.equal(state.matches.length, 0);
    assert.equal(state.notifications.length, 0);
    assert.equal(sends, 0);
    valid = true;
    assert.equal(
      (await runScheduleJob(org, "test-bot", { now: at(10), providers, fetcher })).received,
      1,
    );
    assert.equal(sends, 2);
  } finally {
    await cleanup(org);
  }
});

test("notification retries recheck admin membership and new schedule tables enforce tenant isolation", async () => {
  const org = randomUUID(),
    other = randomUUID();
  try {
    await setup(org);
    await setup(other);
    const matches = normalizeFrcSchedule(await fixture("qualification"), "Qualification");
    const providers = {
      first: {
        source: "frc_events" as const,
        load: async () => ({
          teams: normalizeFrcTeams(await fixture("teams")).teams,
          matches,
          complete: true,
        }),
      },
      tba: {
        source: "tba" as const,
        load: async (): Promise<Snapshot> => {
          throw new Error("not linked");
        },
      },
    };
    const rateLimited: typeof fetch = async () =>
      Response.json(
        { ok: false, error_code: 429, parameters: { retry_after: 600 } },
        { status: 429 },
      );
    await runScheduleJob(org, "test-bot", { now: at(0), providers, fetcher: rateLimited });
    await runScheduleJob(other, "test-bot", { now: at(0), providers, fetcher: rateLimited });
    await withTenant(org, (tx) =>
      tx
        .updateTable("member")
        .set({ role: "scout" })
        .where("organization_id", "=", org)
        .where("name", "=", "2")
        .execute(),
    );
    const sent: string[] = [];
    await runScheduleJob(org, "test-bot", {
      now: at(10),
      providers,
      fetcher: async (_url, options) => {
        sent.push(JSON.parse(String(options?.body)).chat_id);
        return Response.json({ ok: true });
      },
    });
    assert.deepEqual(sent, ["1"]);
    const states = await withTenant(org, (tx) =>
      tx
        .selectFrom("schedule_notification")
        .select("status")
        .where("organization_id", "=", org)
        .execute(),
    );
    assert.deepEqual(states.map((s) => s.status).sort(), ["cancelled", "sent"]);
    await assert.rejects(
      withTenant(org, async (tx) => {
        const role = `schedule_test_${randomUUID().replaceAll("-", "")}`;
        await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(tx);
        await sql`GRANT USAGE ON SCHEMA public TO ${sql.id(role)}`.execute(tx);
        await sql`GRANT SELECT ON schedule_poll,schedule_notification TO ${sql.id(role)}`.execute(
          tx,
        );
        await sql`GRANT ${sql.id(role)} TO CURRENT_USER`.execute(tx);
        await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
        const polls = await tx.selectFrom("schedule_poll").select("organization_id").execute();
        const notifications = await tx
          .selectFrom("schedule_notification")
          .select("organization_id")
          .execute();
        assert.equal(polls.length, 1);
        assert.equal(notifications.length, 2);
        assert.ok([...polls, ...notifications].every((row) => row.organization_id === org));
        throw new Error("rollback-schedule-role-fixture");
      }),
      /rollback-schedule-role-fixture/,
    );
  } finally {
    await cleanup(org);
    await cleanup(other);
  }
});

test("automatic acquisition saves the event roster alongside the schedule", async () => {
  const org = randomUUID();
  try {
    const id = await setup(org);
    process.env.FRC_EVENTS_USERNAME = "fixture";
    process.env.FRC_EVENTS_AUTHORIZATION_KEY = "fixture";
    const fetcher: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("api.telegram.org")) return Response.json({ ok: true });
      if (u.includes("/events?")) return Response.json({ Events: [await fixture("event")] });
      if (u.includes("/teams?")) return Response.json(await fixture("teams"));
      assert.ok(u.includes("/schedule/ONOSH?tournamentLevel=Qualification"));
      return Response.json(await fixture("qualification"));
    };
    await runScheduleJob(org, "test-bot", { now: at(0), fetcher });
    const teams = await withTenant(org, (tx) =>
      tx
        .selectFrom("event_team")
        .select("id")
        .where("organization_id", "=", org)
        .where("event_id", "=", id)
        .execute(),
    );
    assert.equal(teams.length, 6, "schedule acquisition must also persist roster details");
  } finally {
    await cleanup(org);
  }
});

test("legacy schedule-only receipt backfills its roster once without schedule requests or duplicate messages", async () => {
  const org = randomUUID();
  try {
    const id = await setup(org);
    const matches = normalizeFrcSchedule(await fixture("qualification"), "Qualification");
    await syncReference(org, "1", id, {
      source: "frc_events",
      load: async () => ({ teams: [], matches, complete: true }),
    });
    await withTenant(org, (tx) =>
      tx
        .updateTable("schedule_notification")
        .set({ status: "sent", sent_at: at(0) })
        .where("organization_id", "=", org)
        .execute(),
    );
    const before = await withTenant(org, async (tx) => ({
      poll: await tx
        .selectFrom("schedule_poll")
        .selectAll()
        .where("organization_id", "=", org)
        .where("event_id", "=", id)
        .executeTakeFirstOrThrow(),
      matches: await tx
        .selectFrom("event_match")
        .selectAll()
        .where("organization_id", "=", org)
        .orderBy("id")
        .execute(),
    }));
    assert.ok(before.poll.received_at);
    assert.equal(before.poll.roster_received_at, null);
    let rosterCalls = 0;
    const providers = {
      first: {
        source: "frc_events" as const,
        load: async (): Promise<Snapshot> => {
          throw new Error("must not fetch saved schedule");
        },
        loadRoster: async () => {
          rosterCalls++;
          return {
            teams: normalizeFrcTeams(await fixture("teams")).teams,
            matches: [],
            complete: true,
          };
        },
      },
      tba: {
        source: "tba" as const,
        load: async (): Promise<Snapshot> => {
          throw new Error("not linked");
        },
      },
    };
    const fetcher: typeof fetch = async () => {
      throw new Error("must not send another message");
    };
    const results = await Promise.all([
      runScheduleJob(org, "test-bot", { now: at(10), providers, fetcher }),
      runScheduleJob(org, "test-bot", { now: at(10), providers, fetcher }),
    ]);
    assert.equal(rosterCalls, 1);
    assert.equal(
      results.reduce((n, r) => n + r.notified, 0),
      0,
    );
    const after = await withTenant(org, async (tx) => ({
      poll: await tx
        .selectFrom("schedule_poll")
        .selectAll()
        .where("organization_id", "=", org)
        .where("event_id", "=", id)
        .executeTakeFirstOrThrow(),
      teams: await tx
        .selectFrom("event_team")
        .select("id")
        .where("organization_id", "=", org)
        .execute(),
      matches: await tx
        .selectFrom("event_match")
        .selectAll()
        .where("organization_id", "=", org)
        .orderBy("id")
        .execute(),
      notifications: await tx
        .selectFrom("schedule_notification")
        .select("status")
        .where("organization_id", "=", org)
        .execute(),
    }));
    assert.equal(after.teams.length, 6);
    assert.ok(after.poll.roster_received_at);
    assert.deepEqual(after.poll.received_at, before.poll.received_at);
    assert.deepEqual(after.matches, before.matches);
    assert.equal(after.notifications.length, 2);
    assert.ok(after.notifications.every((n) => n.status === "sent"));
    await runScheduleJob(org, "test-bot", { now: at(20), providers, fetcher });
    assert.equal(rosterCalls, 1);
  } finally {
    await cleanup(org);
  }
});
test("a schedule without a usable roster keeps acquisition pending and sends no success message", async () => {
  const org = randomUUID();
  try {
    const id = await setup(org);
    const providers = {
      first: {
        source: "frc_events" as const,
        load: async () => ({
          teams: [],
          matches: normalizeFrcSchedule(await fixture("qualification"), "Qualification"),
          complete: true,
        }),
      },
      tba: {
        source: "tba" as const,
        load: async (): Promise<Snapshot> => {
          throw new Error("not linked");
        },
      },
    };
    const result = await runScheduleJob(org, "test-bot", {
      now: at(0),
      providers,
      fetcher: async () => {
        throw new Error("must not notify");
      },
    });
    assert.equal(result.received, 0);
    assert.equal(result.notified, 0);
    const poll = await withTenant(org, (tx) =>
      tx
        .selectFrom("schedule_poll")
        .selectAll()
        .where("organization_id", "=", org)
        .where("event_id", "=", id)
        .executeTakeFirstOrThrow(),
    );
    assert.equal(poll.received_at, null);
    assert.equal(poll.roster_received_at, null);
  } finally {
    await cleanup(org);
  }
});
