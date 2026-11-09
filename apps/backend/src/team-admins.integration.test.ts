import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { db } from "./db.ts";
import { enrollMember } from "./repositories/members.ts";
import { addOperator, operatorProfile } from "./repositories/operators.ts";
import {
  acceptTeamAdminInvitation as accept,
  accountTeamAdminInvitations,
  cancelTeamAdminInvitation,
  createTeamAdminInvitation,
  listTeamAdminInvitations,
  listTeamAdmins,
  recordTeamAdminInvitation,
  resendTeamAdminInvitation,
} from "./repositories/team-admins.ts";
import {
  adminOrganizations,
  approveWebAdmin,
  linkWebAdmin,
  revokeWebAdmin,
} from "./repositories/web-admin.ts";

after(() => db.destroy());

const subject = () => `user_${randomUUID().replaceAll("-", "")}`;
const email = () => `${randomUUID()}@example.com`;

// A team with one linked, approved admin.
async function team(teamNumber: number) {
  const org = randomUUID();
  const account = subject();
  const member = await enrollMember({
    organizationId: org,
    organizationName: `Team ${teamNumber}`,
    frcTeamNumber: teamNumber,
    memberName: "Lead",
    role: "admin",
    channel: "telegram",
    externalUserId: randomUUID(),
  });
  await approveWebAdmin({ organizationId: org, memberId: member, approverId: member });
  await linkWebAdmin(org, member, account);
  return { org, account, member };
}

async function cleanup(orgs: string[], operators: string[] = []) {
  for (const org of orgs) {
    await db.deleteFrom("team_admin_invitation").where("organization_id", "=", org).execute();
    await db.deleteFrom("web_admin_access").where("organization_id", "=", org).execute();
    await db.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
    await db.deleteFrom("member").where("organization_id", "=", org).execute();
    await db.deleteFrom("organization").where("id", "=", org).execute();
  }
  if (operators.length)
    await db.deleteFrom("platform_operator").where("clerk_user_id", "in", operators).execute();
}

const invitation = (id: string) =>
  db.selectFrom("team_admin_invitation").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

const create = (actor: string, org: string, address: string, target: string | null = null) =>
  createTeamAdminInvitation({
    actor,
    org,
    email: address,
    name: "Riley",
    target,
    adultAttested: true,
  });

test("team admins invite by email; only the matching new account accepts, once", async () => {
  const a = await team(1241);
  const b = await team(1242);
  const newcomer = subject();
  const address = email();
  try {
    // Authorization and tenant isolation.
    assert.equal((await create(b.account, a.org, address)).outcome, "forbidden");
    assert.equal((await create(subject(), a.org, address)).outcome, "forbidden");
    assert.equal((await create(a.account, b.org, address)).outcome, "forbidden");
    assert.equal(
      (
        await createTeamAdminInvitation({
          actor: a.account,
          org: a.org,
          email: address,
          name: "Riley",
          target: null,
          adultAttested: false,
        })
      ).outcome,
      "invalid",
    );
    assert.equal((await create(a.account, a.org, "not-an-email")).outcome, "invalid");
    assert.equal((await create(a.account, a.org, a.account)).outcome, "invalid");

    const created = await create(a.account, a.org, ` ${address.toUpperCase()} `);
    assert.ok(created.outcome === "created");
    assert.equal((await create(a.account, a.org, address)).outcome, "exists");
    assert.equal(await recordTeamAdminInvitation(b.account, a.org, created.id, "inv_x"), false);
    assert.equal(await recordTeamAdminInvitation(a.account, a.org, created.id, "inv_1"), true);
    const [listed] = await listTeamAdminInvitations(a.account, a.org);
    assert.equal(listed?.email, address);
    assert.equal(listed?.invitedByName, "Lead");
    assert.equal(listed?.sent, true);
    assert.equal(listed?.existingAccount, false);
    assert.deepEqual(await listTeamAdminInvitations(b.account, a.org), []);
    assert.deepEqual(await listTeamAdmins(b.account, a.org), []);
    // A pending invitation grants nothing.
    assert.deepEqual(await adminOrganizations(newcomer), []);

    // Email invitations need the ID from Clerk metadata and a verified matching email.
    assert.equal((await accept(newcomer, created.id, [address], false)).outcome, "unavailable");
    assert.equal((await accept(newcomer, created.id, [email()], true)).outcome, "unavailable");
    assert.deepEqual(await accept(newcomer, created.id, [address], true), {
      outcome: "accepted",
      organizationId: a.org,
    });
    assert.deepEqual(await accept(newcomer, created.id, [address], true), {
      outcome: "accepted",
      organizationId: a.org,
    });
    assert.equal((await accept(subject(), created.id, [address], true)).outcome, "unavailable");
    assert.deepEqual(
      (await adminOrganizations(newcomer)).map((org) => org.id),
      [a.org],
    );
    // Team admin invitations never grant platform-operator access.
    assert.equal(await operatorProfile(newcomer), undefined);
    const row = await invitation(created.id);
    assert.equal(row.status, "accepted");
    assert.equal(row.email, null);
    assert.equal(row.accepted_by, newcomer);
    const admins = await listTeamAdmins(a.account, a.org);
    assert.deepEqual(
      admins.map((admin) => [admin.name, admin.linked, admin.isSelf]),
      [
        ["Lead", true, true],
        ["Riley", true, false],
      ],
    );
    const access = await db
      .selectFrom("web_admin_access")
      .selectAll()
      .where("organization_id", "=", a.org)
      .where("clerk_user_id", "=", newcomer)
      .executeTakeFirstOrThrow();
    assert.equal(access.approved_by, a.member);
    assert.equal(access.policy_version, "admin-invited-v1");
    // The new admin can invite in turn.
    assert.equal((await create(newcomer, a.org, email())).outcome, "created");
  } finally {
    await cleanup([a.org, b.org]);
  }
});

test("existing accounts, including other teams' admins and operators, accept in the app", async () => {
  const a = await team(1241);
  const b = await team(1243);
  const operator = subject();
  const bAddress = email();
  const operatorAddress = email();
  try {
    await addOperator(operator, "Operator");
    assert.equal((await create(a.account, a.org, email(), a.account)).outcome, "already_admin");
    const forB = await create(a.account, a.org, bAddress, b.account);
    assert.ok(forB.outcome === "created");
    assert.equal((await create(a.account, a.org, email(), b.account)).outcome, "exists");
    const [pending] = await listTeamAdminInvitations(a.account, a.org);
    assert.equal(pending?.existingAccount, true);
    assert.equal(pending?.sent, true);
    assert.deepEqual(
      (await accountTeamAdminInvitations(b.account)).map((i) => [i.id, i.teamNumber]),
      [[forB.id, 1241]],
    );
    assert.deepEqual(await accountTeamAdminInvitations(operator), []);

    // Bound to the account: another account with the same email cannot accept.
    assert.equal((await accept(operator, forB.id, [bAddress], false)).outcome, "unavailable");
    assert.equal((await accept(b.account, forB.id, [email()], false)).outcome, "unavailable");
    // Concurrent acceptance creates one membership.
    const results = await Promise.all([
      accept(b.account, forB.id, [bAddress], false),
      accept(b.account, forB.id, [bAddress], false),
    ]);
    assert.deepEqual(
      results.map((r) => r.outcome),
      ["accepted", "accepted"],
    );
    assert.deepEqual(
      (await adminOrganizations(b.account)).map((org) => org.teamNumber),
      [1241, 1243],
    );
    const members = await db
      .selectFrom("member")
      .select("id")
      .where("organization_id", "=", a.org)
      .execute();
    assert.equal(members.length, 2);
    assert.deepEqual(await accountTeamAdminInvitations(b.account), []);

    // An operator keeps operator access and gains the team.
    const forOperator = await create(a.account, a.org, operatorAddress, operator);
    assert.ok(forOperator.outcome === "created");
    assert.equal(
      (await accept(operator, forOperator.id, [operatorAddress], false)).outcome,
      "accepted",
    );
    assert.equal((await operatorProfile(operator))?.name, "Operator");
    assert.deepEqual(
      (await adminOrganizations(operator)).map((org) => org.id),
      [a.org],
    );
  } finally {
    await cleanup([a.org, b.org], [operator]);
  }
});

test("an account already linked to the team is not linked twice", async () => {
  const a = await team(1241);
  const second = subject();
  const address = email();
  try {
    const created = await create(a.account, a.org, address);
    assert.ok(created.outcome === "created");
    // The account became an admin another way after the invitation was sent.
    const other = await create(a.account, a.org, email(), second);
    assert.ok(other.outcome === "created");
    const otherRow = await invitation(other.id);
    assert.equal(
      (await accept(second, other.id, [otherRow.email ?? ""], false)).outcome,
      "accepted",
    );
    assert.deepEqual(await accept(second, created.id, [address], true), {
      outcome: "already_admin",
      organizationId: a.org,
    });
    const links = await db
      .selectFrom("web_admin_access")
      .select("member_id")
      .where("organization_id", "=", a.org)
      .where("clerk_user_id", "=", second)
      .execute();
    assert.equal(links.length, 1);
    assert.equal((await invitation(created.id)).accepted_member_id, links[0]?.member_id);
  } finally {
    await cleanup([a.org]);
  }
});

test("Telegram members are never merged by name", async () => {
  const a = await team(1241);
  const newcomer = subject();
  const address = email();
  try {
    const scout = await enrollMember({
      organizationId: a.org,
      organizationName: "Team 1241",
      frcTeamNumber: 1241,
      memberName: "Riley",
      role: "scout",
      channel: "telegram",
      externalUserId: randomUUID(),
    });
    const created = await create(a.account, a.org, address);
    assert.ok(created.outcome === "created");
    assert.equal((await accept(newcomer, created.id, [address], true)).outcome, "accepted");
    const access = await db
      .selectFrom("web_admin_access")
      .select("member_id")
      .where("organization_id", "=", a.org)
      .where("clerk_user_id", "=", newcomer)
      .executeTakeFirstOrThrow();
    assert.notEqual(access.member_id, scout);
    const scoutRow = await db
      .selectFrom("member")
      .select("role")
      .where("id", "=", scout)
      .executeTakeFirstOrThrow();
    assert.equal(scoutRow.role, "scout");
    const identities = await db
      .selectFrom("channel_identity")
      .select("member_id")
      .where("organization_id", "=", a.org)
      .where("member_id", "=", access.member_id)
      .execute();
    assert.deepEqual(identities, []);
  } finally {
    await cleanup([a.org]);
  }
});

test("cancelled, expired and superseded invitations cannot grant access", async () => {
  const a = await team(1241);
  const b = await team(1244);
  const newcomer = subject();
  const address = email();
  try {
    // Cancel.
    const cancelled = await create(a.account, a.org, address);
    assert.ok(cancelled.outcome === "created");
    await recordTeamAdminInvitation(a.account, a.org, cancelled.id, "inv_cancel");
    assert.equal(
      (await cancelTeamAdminInvitation(b.account, a.org, cancelled.id)).outcome,
      "forbidden",
    );
    assert.equal(
      (await cancelTeamAdminInvitation(b.account, b.org, cancelled.id)).outcome,
      "not_found",
    );
    assert.deepEqual(await cancelTeamAdminInvitation(a.account, a.org, cancelled.id), {
      outcome: "cancelled",
      clerkInvitationId: "inv_cancel",
    });
    assert.equal((await invitation(cancelled.id)).email, null);
    assert.equal((await accept(newcomer, cancelled.id, [address], true)).outcome, "unavailable");

    // Expire.
    const expired = await create(a.account, a.org, address);
    assert.ok(expired.outcome === "created");
    await db
      .updateTable("team_admin_invitation")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("id", "=", expired.id)
      .execute();
    assert.equal((await accept(newcomer, expired.id, [address], true)).outcome, "unavailable");
    const expiredRow = await invitation(expired.id);
    assert.equal(expiredRow.status, "expired");
    assert.equal(expiredRow.email, null);

    // Resend replaces the invitation; the earlier ID stops working.
    const first = await create(a.account, a.org, address);
    assert.ok(first.outcome === "created");
    await recordTeamAdminInvitation(a.account, a.org, first.id, "inv_first");
    assert.equal(
      (await resendTeamAdminInvitation(b.account, a.org, first.id)).outcome,
      "forbidden",
    );
    const resent = await resendTeamAdminInvitation(a.account, a.org, first.id);
    assert.ok(resent.outcome === "resent");
    assert.equal(resent.email, address);
    assert.equal(resent.previousClerkInvitationId, "inv_first");
    assert.equal(resent.existingAccount, false);
    assert.equal((await invitation(first.id)).status, "superseded");
    assert.equal(
      (await resendTeamAdminInvitation(a.account, a.org, first.id)).outcome,
      "not_found",
    );
    const listed = await listTeamAdminInvitations(a.account, a.org);
    assert.deepEqual(
      listed.map((i) => [i.id, i.sent]),
      [[resent.id, false]],
    );
    assert.equal((await accept(newcomer, first.id, [address], true)).outcome, "unavailable");
    assert.equal((await accept(newcomer, resent.id, [address], true)).outcome, "accepted");
  } finally {
    await cleanup([a.org, b.org]);
  }
});

test("revoking the inviter blocks their invitations and their access", async () => {
  const a = await team(1241);
  const newcomer = subject();
  const existing = subject();
  const address = email();
  const existingAddress = email();
  try {
    const created = await create(a.account, a.org, address);
    assert.ok(created.outcome === "created");
    const bound = await create(a.account, a.org, existingAddress, existing);
    assert.ok(bound.outcome === "created");
    await revokeWebAdmin(a.org, a.member);
    assert.equal((await create(a.account, a.org, email())).outcome, "forbidden");
    assert.deepEqual(await listTeamAdminInvitations(a.account, a.org), []);
    assert.deepEqual(await accountTeamAdminInvitations(existing), []);
    assert.equal((await accept(newcomer, created.id, [address], true)).outcome, "unavailable");
    assert.equal(
      (await accept(existing, bound.id, [existingAddress], false)).outcome,
      "unavailable",
    );
    assert.deepEqual(await adminOrganizations(newcomer), []);
    // Restoring the inviter's approval restores their invitations.
    await approveWebAdmin({ organizationId: a.org, memberId: a.member, approverId: a.member });
    await linkWebAdmin(a.org, a.member, a.account);
    assert.equal((await accept(newcomer, created.id, [address], true)).outcome, "accepted");
    const later = await create(a.account, a.org, email());
    assert.ok(later.outcome === "created");
    // Demotion also counts as revocation.
    await db.updateTable("member").set({ role: "scout" }).where("id", "=", a.member).execute();
    assert.equal((await create(a.account, a.org, email())).outcome, "forbidden");
    assert.equal(
      (await resendTeamAdminInvitation(a.account, a.org, later.id)).outcome,
      "forbidden",
    );
  } finally {
    await cleanup([a.org]);
  }
});

test("the runtime role has no table access and works only through the functions", async () => {
  const a = await team(1241);
  const role = `team_admin_test_${randomUUID().replaceAll("-", "")}`;
  await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(db);
  await sql`GRANT EXECUTE ON FUNCTION list_team_admins(text, uuid) TO ${sql.id(role)}`.execute(db);
  const asRuntime = <T>(run: (tx: typeof db) => Promise<T>) =>
    db.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
      return run(tx);
    });
  try {
    await assert.rejects(
      asRuntime((tx) => tx.selectFrom("team_admin_invitation").select("id").execute()),
      /permission denied/,
    );
    await assert.rejects(
      asRuntime((tx) => sql`select team_admin_actor(${a.account}, ${a.org}::uuid)`.execute(tx)),
      /permission denied/,
    );
    const { rows } = await asRuntime((tx) =>
      sql<{ name: string }>`select * from list_team_admins(${a.account}, ${a.org}::uuid)`.execute(
        tx,
      ),
    );
    assert.deepEqual(
      rows.map((row) => row.name),
      ["Lead"],
    );
  } finally {
    await cleanup([a.org]);
    await sql`DROP OWNED BY ${sql.id(role)}`.execute(db);
    await sql`DROP ROLE ${sql.id(role)}`.execute(db);
  }
});
