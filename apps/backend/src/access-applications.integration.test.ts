import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { accessApplicationRoutes } from "./access-applications.ts";
import { db } from "./db.ts";
import { saveAccessApplication } from "./repositories/access-applications.ts";

after(() => db.destroy());

test("public submissions persist as pending, retries deduplicate, and no membership is created", async () => {
  const id = randomUUID();
  const email = `${id}@example.com`;
  const input = {
    id,
    name: "Application fixture",
    email,
    teamNumber: "1241",
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
  const before = await db
    .selectFrom("member")
    .where("organization_id", "=", input.organizationId)
    .select((eb) => eb.fn.countAll().as("count"))
    .executeTakeFirstOrThrow();
  try {
    const responses = await Promise.all([
      submit(),
      submit(),
      submit({ ...input, id: randomUUID(), email: email.toUpperCase() }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { received: true });
    }
    const rows = await db
      .selectFrom("access_application")
      .selectAll()
      .where("email", "=", email)
      .execute();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.name, input.name);
    assert.equal(row.team_number, 1241);
    assert.equal(row.team_role, "mentor");
    assert.equal(row.adult_attested, true);
    assert.equal(row.status, "pending");
    assert.ok(row.created_at instanceof Date);
    const afterCount = await db
      .selectFrom("member")
      .where("organization_id", "=", input.organizationId)
      .select((eb) => eb.fn.countAll().as("count"))
      .executeTakeFirstOrThrow();
    assert.equal(afterCount.count, before.count);
  } finally {
    await db.deleteFrom("access_application").where("email", "=", email).execute();
  }
});

test("runtime can only insert pending applications; cannot read, change, or delete applications", async () => {
  const role = `application_test_${randomUUID().replaceAll("-", "")}`;
  const id = randomUUID();
  await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(db);
  await sql`GRANT INSERT (id, name, email, team_number, team_role, adult_attested) ON access_application TO ${sql.id(role)}`.execute(
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
    team_number: 1241,
    team_role: "other",
    adult_attested: true,
  };
  try {
    await restricted((tx) =>
      tx
        .insertInto("access_application")
        .values(values)
        .onConflict((c) => c.doNothing())
        .execute(),
    );
    await restricted((tx) =>
      tx
        .insertInto("access_application")
        .values(values)
        .onConflict((c) => c.doNothing())
        .execute(),
    );
    await assert.rejects(
      restricted((tx) => tx.selectFrom("access_application").selectAll().execute()),
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
        tx
          .insertInto("access_application")
          .values({ ...values, id: randomUUID(), status: "approved" })
          .execute(),
      ),
      /permission denied/,
    );
    await assert.rejects(
      restricted((tx) =>
        tx
          .insertInto("access_application")
          .values({ ...values, id: randomUUID(), adult_attested: false })
          .execute(),
      ),
      /row-level security|check constraint/,
    );
  } finally {
    await db.deleteFrom("access_application").where("id", "=", id).execute();
    await sql`DROP OWNED BY ${sql.id(role)}`.execute(db);
    await sql`DROP ROLE ${sql.id(role)}`.execute(db);
  }
});
