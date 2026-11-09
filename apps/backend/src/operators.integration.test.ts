import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { db } from "./db.ts";
import { saveAccessApplication } from "./repositories/access-applications.ts";
import {
  addOperator,
  approveApplication,
  claimApplication,
  grantOperator,
  invitableApplication,
  listOperators,
  operatorProfile,
  recordInvitation,
  rejectApplication,
  removeOperator,
  reviewApplications,
  revokeOperator,
} from "./repositories/operators.ts";
import { adminOrganizations } from "./repositories/web-admin.ts";

after(() => db.destroy());

const subject = () => `user_${randomUUID().replaceAll("-", "")}`;

async function submit(teamNumber: number) {
  const id = randomUUID();
  const email = `${id}@example.com`;
  assert.equal(
    await saveAccessApplication({
      id,
      name: "Avery Lead",
      email,
      teamNumber,
      role: "lead_mentor",
      adultAttested: true,
    }),
    "received",
  );
  return { id, email };
}

async function cleanup(teams: number[], operators: string[]) {
  const apps = await db
    .selectFrom("access_application")
    .select("organization_id")
    .where("team_number", "in", teams)
    .execute();
  await db.deleteFrom("access_application").where("team_number", "in", teams).execute();
  for (const org of apps.map((row) => row.organization_id).filter((id) => id !== null)) {
    await db.deleteFrom("web_admin_access").where("organization_id", "=", org).execute();
    await db.deleteFrom("member").where("organization_id", "=", org).execute();
    await db.deleteFrom("organization").where("id", "=", org).execute();
  }
  await db.deleteFrom("platform_operator").where("clerk_user_id", "in", operators).execute();
}

test("operators review applications; approval provisions the team and the invitee claims it", async () => {
  const operator = subject();
  const outsider = subject();
  const invitee = subject();
  const teams = [randomInt(10_000, 99_999), randomInt(10_000, 99_999)];
  const [approvedTeam, rejectedTeam] = teams as [number, number];
  try {
    await addOperator(operator, "Platform operator");
    assert.deepEqual(await operatorProfile(operator), { name: "Platform operator" });
    assert.equal(await operatorProfile(outsider), undefined);
    const approved = await submit(approvedTeam);
    const rejected = await submit(rejectedTeam);

    // Only operators can read or change applications.
    assert.deepEqual(await reviewApplications(outsider, "pending"), []);
    assert.equal((await approveApplication(outsider, approved.id, "Team")).outcome, "forbidden");
    assert.equal(await rejectApplication(outsider, rejected.id), "forbidden");
    const pending = await reviewApplications(operator, "pending");
    assert.ok(pending.some((row) => row.id === approved.id && row.status === "pending"));

    assert.equal((await approveApplication(operator, approved.id, " ")).outcome, "invalid_name");
    const result = await approveApplication(operator, approved.id, "  Theory6  ");
    assert.equal(result.outcome, "approved");
    assert.ok(result.outcome === "approved");
    assert.equal(result.email, approved.email);
    assert.equal(
      (await approveApplication(operator, approved.id, "Theory6")).outcome,
      "not_pending",
    );
    const organization = await db
      .selectFrom("organization")
      .selectAll()
      .where("id", "=", result.organizationId)
      .executeTakeFirstOrThrow();
    assert.equal(organization.name, "Theory6");
    assert.equal(organization.frc_team_number, approvedTeam);
    const member = await db
      .selectFrom("member")
      .selectAll()
      .where("id", "=", result.memberId)
      .executeTakeFirstOrThrow();
    assert.equal(member.role, "admin");
    assert.equal(member.name, "Avery Lead");
    const access = await db
      .selectFrom("web_admin_access")
      .selectAll()
      .where("member_id", "=", result.memberId)
      .executeTakeFirstOrThrow();
    assert.equal(access.clerk_user_id, null);
    assert.equal(access.policy_version, "operator-approved-v1");

    // Approved and rejected teams cannot apply again.
    assert.equal(await rejectApplication(operator, rejected.id), "rejected");
    assert.equal(await rejectApplication(operator, rejected.id), "not_pending");
    assert.equal((await approveApplication(operator, rejected.id, "Team")).outcome, "not_pending");
    for (const team of teams)
      assert.equal(
        await saveAccessApplication({
          id: randomUUID(),
          name: "Second applicant",
          email: `${randomUUID()}@example.com`,
          teamNumber: team,
          role: "mentor",
          adultAttested: true,
        }),
        "team_exists",
      );
    const reviewed = await reviewApplications(operator, "reviewed");
    assert.equal(reviewed.find((row) => row.id === rejected.id)?.status, "rejected");
    assert.equal(
      reviewed.find((row) => row.id === approved.id)?.organizationId,
      result.organizationId,
    );

    // Invitation bookkeeping is operator-only.
    assert.equal(await recordInvitation(outsider, approved.id, "inv_x"), false);
    assert.equal(await recordInvitation(operator, approved.id, "inv_1"), true);
    assert.equal(await recordInvitation(operator, rejected.id, "inv_2"), false);
    assert.equal((await invitableApplication(operator, approved.id))?.email, approved.email);
    assert.equal(await invitableApplication(operator, rejected.id), undefined);

    // Claim needs a verified email that matches the application.
    assert.deepEqual(await adminOrganizations(invitee), []);
    assert.equal(await claimApplication(invitee, approved.id, ["other@example.com"]), null);
    assert.equal(await claimApplication(invitee, rejected.id, [rejected.email]), null);
    assert.equal(
      await claimApplication(invitee, approved.id, [approved.email]),
      result.organizationId,
    );
    assert.equal(
      await claimApplication(invitee, approved.id, [approved.email]),
      result.organizationId,
    );
    assert.equal(await claimApplication(outsider, approved.id, [approved.email]), null);
    assert.deepEqual(
      (await adminOrganizations(invitee)).map((org) => org.id),
      [result.organizationId],
    );
    assert.equal(await invitableApplication(operator, approved.id), undefined);
    assert.equal(await recordInvitation(operator, approved.id, "inv_3"), false);

    // Removing the operator record removes review access at once.
    assert.equal(await removeOperator(operator), true);
    assert.deepEqual(await reviewApplications(operator, "reviewed"), []);
  } finally {
    await cleanup(teams, [operator]);
  }
});

test("approval refuses a team that already has an organization", async () => {
  const operator = subject();
  const team = randomInt(10_000, 99_999);
  try {
    await addOperator(operator, "Operator");
    const application = await submit(team);
    const orgId = randomUUID();
    await db.transaction().execute(async (tx) => {
      await sql`select set_config('app.organization_id', ${orgId}, true)`.execute(tx);
      await tx
        .insertInto("organization")
        .values({ id: orgId, name: "Created elsewhere", frc_team_number: team })
        .execute();
    });
    assert.equal(
      (await approveApplication(operator, application.id, "Team")).outcome,
      "team_exists",
    );
    await db.deleteFrom("organization").where("id", "=", orgId).execute();
  } finally {
    await cleanup([team], [operator]);
  }
});

test("runtime role reads only through operator RLS and changes state only through functions", async () => {
  const role = `operator_test_${randomUUID().replaceAll("-", "")}`;
  const operator = subject();
  const team = randomInt(10_000, 99_999);
  await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(db);
  await sql`GRANT SELECT ON access_application, platform_operator TO ${sql.id(role)}`.execute(db);
  await sql`GRANT EXECUTE ON FUNCTION approve_access_application(uuid, text, text), reject_access_application(uuid, text) TO ${sql.id(role)}`.execute(
    db,
  );
  const asRuntime = <T>(as: string, run: (tx: typeof db) => Promise<T>) =>
    db.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
      await sql`select set_config('app.clerk_user_id', ${as}, true)`.execute(tx);
      return run(tx);
    });
  try {
    await addOperator(operator, "Operator");
    const application = await submit(team);
    const visible = (as: string) =>
      asRuntime(as, (tx) =>
        tx.selectFrom("access_application").select("id").where("id", "=", application.id).execute(),
      );
    assert.equal((await visible("user_nobody")).length, 0);
    assert.equal((await visible(operator)).length, 1);
    assert.deepEqual(
      await asRuntime("user_nobody", (tx) =>
        tx.selectFrom("platform_operator").select("clerk_user_id").execute(),
      ),
      [],
    );
    await assert.rejects(
      asRuntime(operator, (tx) =>
        tx
          .updateTable("access_application")
          .set({ status: "rejected" })
          .where("id", "=", application.id)
          .execute(),
      ),
      /permission denied/,
    );
    await assert.rejects(
      asRuntime(operator, (tx) =>
        tx.insertInto("platform_operator").values({ clerk_user_id: "user_x", name: "x" }).execute(),
      ),
      /permission denied/,
    );
    const { rows } = await asRuntime(operator, (tx) =>
      sql<{
        outcome: string;
      }>`select * from approve_access_application(${application.id}::uuid, ${operator}, 'Runtime team')`.execute(
        tx,
      ),
    );
    assert.equal(rows[0]?.outcome, "approved");
  } finally {
    await cleanup([team], [operator]);
    await sql`DROP OWNED BY ${sql.id(role)}`.execute(db);
    await sql`DROP ROLE ${sql.id(role)}`.execute(db);
  }
});

test("operators add and remove other operators, never themselves", async () => {
  const first = subject();
  const second = subject();
  const outsider = subject();
  try {
    await addOperator(first, "First");
    assert.deepEqual(await listOperators(outsider), []);
    assert.equal(await grantOperator(outsider, second, "Second"), "forbidden");
    assert.equal(await grantOperator(first, "not-a-user", "Second"), "invalid");
    assert.equal(await grantOperator(first, second, " "), "invalid");
    assert.equal(await grantOperator(first, second, "  Second  "), "added");
    assert.equal(await grantOperator(first, second, "Second again"), "exists");
    const listed = await listOperators(second);
    const added = listed.find((operator) => operator.clerkUserId === second);
    assert.equal(added?.name, "Second");
    assert.equal(added?.addedByName, "First");
    assert.equal(await revokeOperator(first, first), "self");
    assert.equal(await revokeOperator(outsider, first), "forbidden");
    assert.equal(await revokeOperator(second, first), "removed");
    assert.equal(await revokeOperator(second, first), "not_found");
    assert.deepEqual(await listOperators(first), []);
    assert.equal(await grantOperator(first, outsider, "Outsider"), "forbidden");
  } finally {
    await db
      .deleteFrom("platform_operator")
      .where("clerk_user_id", "in", [first, second, outsider])
      .execute();
  }
});
