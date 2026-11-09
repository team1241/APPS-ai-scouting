import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { accessApplicationRoutes } from "./access-applications.ts";
import { db } from "./db.ts";
import { saveAccessApplication } from "./repositories/access-applications.ts";
import { enrollMember } from "./repositories/members.ts";

after(() => db.destroy());

// Fixtures use unique team numbers because any application blocks its team.
const freshTeam = () => randomInt(10_000, 99_999);

test("public submissions persist as pending, retries deduplicate, and no membership is created", async () => {
  const id = randomUUID();
  const email = `${id}@example.com`;
  const teamNumber = freshTeam();
  const input = {
    id,
    name: "Application fixture",
    email,
    teamNumber: String(teamNumber),
    role: "mentor",
    adultAttested: true,
    status: "approved",
    organizationId: randomUUID(),
  };
  const app = accessApplicationRoutes({ save: saveAccessApplication });
  const submit = (data = input) =>
    app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  try {
    const responses = await Promise.all([submit(), submit()]);
    for (const response of responses) {
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { received: true });
    }
    const rows = await db
      .selectFrom("access_application")
      .selectAll()
      .where("team_number", "=", teamNumber)
      .execute();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.name, input.name);
    assert.equal(row.email, email);
    assert.equal(row.team_role, "mentor");
    assert.equal(row.adult_attested, true);
    assert.equal(row.status, "pending");
    assert.equal(row.organization_id, null);
    assert.ok(row.created_at instanceof Date);
    const members = await db
      .selectFrom("organization")
      .where("frc_team_number", "=", teamNumber)
      .select((eb) => eb.fn.countAll().as("count"))
      .executeTakeFirstOrThrow();
    assert.equal(Number(members.count), 0);
  } finally {
    await db.deleteFrom("access_application").where("team_number", "=", teamNumber).execute();
  }
});

test("pending and rejected applications and existing organizations block the team", async () => {
  const save = (teamNumber: number, id = randomUUID()) =>
    saveAccessApplication({
      id,
      name: "Duplicate fixture",
      email: `${id}@example.com`,
      teamNumber,
      role: "other",
      adultAttested: true,
    });
  const [firstTeam, rejectedTeam] = [freshTeam(), freshTeam()];
  const teams = [firstTeam, rejectedTeam];
  const organizationTeam = freshTeam();
  const organizationId = randomUUID();
  try {
    // Concurrent first submissions for one team: exactly one is saved.
    const outcomes = await Promise.all([save(firstTeam), save(firstTeam), save(firstTeam)]);
    assert.deepEqual(outcomes.toSorted(), ["received", "team_exists", "team_exists"]);
    // Approved applications are covered by the operator review tests.
    assert.equal(await save(rejectedTeam), "received");
    await db
      .updateTable("access_application")
      .set({ status: "rejected", reviewed_at: new Date(), reviewed_by: "user_fixture" })
      .where("team_number", "=", rejectedTeam)
      .execute();
    assert.equal(await save(rejectedTeam), "team_exists");
    await enrollMember({
      organizationId,
      organizationName: "Existing team",
      frcTeamNumber: organizationTeam,
      memberName: "Lead",
      role: "admin",
      channel: "telegram",
      externalUserId: randomUUID(),
    });
    assert.equal(await save(organizationTeam), "team_exists");
  } finally {
    await db.deleteFrom("access_application").where("team_number", "in", teams).execute();
    await db.deleteFrom("channel_identity").where("organization_id", "=", organizationId).execute();
    await db.deleteFrom("member").where("organization_id", "=", organizationId).execute();
    await db.deleteFrom("organization").where("id", "=", organizationId).execute();
  }
});

test("runtime submits only through the database function and cannot read, change or delete applications", async () => {
  const role = `application_test_${randomUUID().replaceAll("-", "")}`;
  const id = randomUUID();
  const teamNumber = freshTeam();
  await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(db);
  await sql`GRANT SELECT ON access_application, platform_operator TO ${sql.id(role)}`.execute(db);
  await sql`GRANT EXECUTE ON FUNCTION submit_access_application(uuid, text, text, integer, text, boolean) TO ${sql.id(role)}`.execute(
    db,
  );
  const restricted = (run: (tx: typeof db) => Promise<unknown>) =>
    db.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
      return run(tx);
    });
  const values = {
    id,
    name: "Runtime fixture",
    email: `${id}@example.com`,
    team_number: teamNumber,
    team_role: "other",
    adult_attested: true,
  };
  try {
    const submit = () =>
      restricted((tx) =>
        sql`select submit_access_application(${id}::uuid, 'Runtime fixture', ${values.email}, ${teamNumber}, 'other', true)`.execute(
          tx,
        ),
      );
    await submit();
    await submit();
    assert.deepEqual(
      await restricted((tx) => tx.selectFrom("access_application").selectAll().execute()),
      [],
    );
    await assert.rejects(
      restricted((tx) =>
        tx
          .insertInto("access_application")
          .values({ ...values, id: randomUUID() })
          .execute(),
      ),
      /permission denied/,
    );
    await assert.rejects(
      restricted((tx) =>
        tx.updateTable("access_application").set({ status: "approved" }).execute(),
      ),
      /permission denied/,
    );
    await assert.rejects(
      restricted((tx) => tx.deleteFrom("access_application").execute()),
      /permission denied/,
    );
    await assert.rejects(
      restricted((tx) =>
        sql`select approve_access_application(${id}::uuid, 'user_fixture', 'Team')`.execute(tx),
      ),
      /permission denied/,
    );
    await assert.rejects(
      db
        .insertInto("access_application")
        .values({ ...values, id: randomUUID(), team_number: freshTeam(), adult_attested: false })
        .execute(),
      /check constraint/,
    );
  } finally {
    await db.deleteFrom("access_application").where("id", "=", id).execute();
    await sql`DROP OWNED BY ${sql.id(role)}`.execute(db);
    await sql`DROP ROLE ${sql.id(role)}`.execute(db);
  }
});
