import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { secretCipher } from "./api-keys.ts";
import { db } from "./db.ts";
import { activeApiKey } from "./repositories/api-keys.ts";
import { enrollMember } from "./repositories/members.ts";
import {
  directoryTeam,
  listDirectoryTeams,
  removeDirectoryAdmin,
  revealApiKeyCiphertext,
  revokeDirectoryApiKey,
  TEAMS_PAGE_SIZE,
} from "./repositories/operator-teams.ts";
import { addOperator, removeOperator } from "./repositories/operators.ts";
import { createTeamAdminInvitation } from "./repositories/team-admins.ts";
import { adminOrganizations, approveWebAdmin, linkWebAdmin } from "./repositories/web-admin.ts";

const subject = () => `user_${randomUUID().replaceAll("-", "")}`;
const cipher = secretCipher(randomBytes(32).toString("base64"));
// High, random team numbers keep these fixtures apart from other test data.
const base = 70000 + randomInt(0, 9000) * 2;
// A name token that only this run's teams contain, for exact search results.
const token = `dir${randomUUID().slice(0, 8)}`;
const orgs: string[] = [];
const operators: string[] = [];

async function team(teamNumber: number, name = `${token} Robotics ${teamNumber}`) {
  const org = randomUUID();
  orgs.push(org);
  await db
    .insertInto("organization")
    .values({ id: org, name, frc_team_number: teamNumber })
    .execute();
  return org;
}

async function member(org: string, role: "scout" | "admin", name: string) {
  const row = await db
    .selectFrom("organization")
    .select(["name", "frc_team_number"])
    .where("id", "=", org)
    .executeTakeFirstOrThrow();
  return enrollMember({
    organizationId: org,
    organizationName: row.name,
    frcTeamNumber: row.frc_team_number,
    memberName: name,
    role,
    channel: "telegram",
    externalUserId: randomUUID(),
  });
}

async function key(org: string, name: string, secret: string | null) {
  const row = await db
    .insertInto("api_key")
    .values({
      organization_id: org,
      name,
      provider_key_id: `key_${randomUUID()}`,
      start: (secret ?? "scout_gone").slice(0, 10),
      secret_ciphertext: secret === null ? null : cipher.encrypt(secret),
      rate_limit_per_minute: 60,
      revoked_at: secret === null ? new Date() : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function operator() {
  const account = subject();
  operators.push(account);
  await addOperator(account, "Operator");
  return account;
}

after(async () => {
  for (const org of orgs) {
    await db.deleteFrom("team_admin_invitation").where("organization_id", "=", org).execute();
    await db.deleteFrom("api_key").where("organization_id", "=", org).execute();
    await db.deleteFrom("web_admin_access").where("organization_id", "=", org).execute();
    await db.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
    await db.deleteFrom("member").where("organization_id", "=", org).execute();
    await db.deleteFrom("organization").where("id", "=", org).execute();
  }
  if (operators.length)
    await db.deleteFrom("platform_operator").where("clerk_user_id", "in", operators).execute();
  await db.destroy();
});

test("operators list every team, including teams with no admins or keys, with search and paging", async () => {
  const actor = await operator();
  const empty = await team(base);
  const full = await team(base + 1);
  const lead = await member(full, "admin", "Lead");
  await approveWebAdmin({ organizationId: full, memberId: lead, approverId: lead });
  const leadAccount = subject();
  await linkWebAdmin(full, lead, leadAccount);
  await member(full, "admin", "Backend only");
  await member(full, "scout", "Scout");
  await key(full, "Website", "scout_live_1");
  await key(full, "Old", null);
  await createTeamAdminInvitation({
    actor: leadAccount,
    org: full,
    email: `${randomUUID()}@example.com`,
    name: "Riley",
    target: null,
    adultAttested: true,
  });

  const page = await listDirectoryTeams(actor, token, 1);
  assert.equal(page.total, 2);
  assert.deepEqual(
    page.teams.map((t) => [
      t.id,
      t.adminCount,
      t.webAdminCount,
      t.pendingInvitationCount,
      t.activeKeyCount,
    ]),
    [
      [empty, 0, 0, 0, 0],
      [full, 2, 1, 1, 1],
    ],
  );
  // Number prefix and name searches, case-insensitive.
  assert.deepEqual(
    (await listDirectoryTeams(actor, String(base + 1), 1)).teams.map((t) => t.id),
    [full],
  );
  assert.equal((await listDirectoryTeams(actor, token.toUpperCase(), 1)).total, 2);
  // LIKE wildcards are matched literally.
  assert.equal((await listDirectoryTeams(actor, "%", 1)).total, 0);
  assert.equal((await listDirectoryTeams(actor, `${token}_`, 1)).total, 0);
  // An unfiltered list includes these teams among all others.
  const all = await listDirectoryTeams(actor, "", 1);
  assert.ok(all.total >= 2);
  assert.ok(all.teams.length <= TEAMS_PAGE_SIZE);
  // A page past the end is empty but still reports the total.
  assert.deepEqual(await listDirectoryTeams(actor, token, 2), { teams: [], total: 2 });

  // Team admins and strangers see nothing.
  assert.deepEqual(await listDirectoryTeams(leadAccount, token, 1), { teams: [], total: 0 });
  assert.deepEqual(await listDirectoryTeams(subject(), token, 1), { teams: [], total: 0 });
  assert.equal(await directoryTeam(leadAccount, full), undefined);
});

test("paging is bounded and ordered by team number", async () => {
  const actor = await operator();
  const pageToken = `pg${randomUUID().slice(0, 8)}`;
  const many = await Promise.all(
    Array.from({ length: TEAMS_PAGE_SIZE + 2 }, (_, i) =>
      team(base + 100 + i, `${pageToken} ${i}`),
    ),
  );
  const first = await listDirectoryTeams(actor, pageToken, 1);
  const second = await listDirectoryTeams(actor, pageToken, 2);
  assert.equal(first.total, many.length);
  assert.equal(first.teams.length, TEAMS_PAGE_SIZE);
  assert.equal(second.teams.length, 2);
  const numbers = [...first.teams, ...second.teams].map((t) => t.teamNumber);
  assert.deepEqual(
    numbers,
    [...numbers].sort((a, b) => a - b),
  );
  assert.equal(new Set([...first.teams, ...second.teams].map((t) => t.id)).size, many.length);
  // The database clamps the page size to between 1 and 50.
  const size = async (limit: number) =>
    (await sql`select * from list_operator_teams(${actor}, ${pageToken}, ${limit}, 0)`.execute(db))
      .rows.length;
  assert.equal(await size(0), 1);
  assert.equal(await size(500), many.length);
  assert.equal(
    (await sql`select * from list_operator_teams(${actor}, '', 500, 0)`.execute(db)).rows.length <=
      50,
    true,
  );
});

test("team detail separates backend admins, approved admins and linked web admins", async () => {
  const actor = await operator();
  const org = await team(base + 2);
  const linked = await member(org, "admin", "Linked");
  const approved = await member(org, "admin", "Approved");
  const backend = await member(org, "admin", "Backend");
  const scout = await member(org, "scout", "Scout");
  const linkedAccount = subject();
  await approveWebAdmin({ organizationId: org, memberId: linked, approverId: linked });
  await linkWebAdmin(org, linked, linkedAccount);
  await approveWebAdmin({ organizationId: org, memberId: approved, approverId: linked });
  const address = `${randomUUID()}@example.com`;
  const invited = await createTeamAdminInvitation({
    actor: linkedAccount,
    org,
    email: address,
    name: "Riley",
    target: null,
    adultAttested: true,
  });
  assert.ok(invited.outcome === "created");
  const expired = await createTeamAdminInvitation({
    actor: linkedAccount,
    org,
    email: `${randomUUID()}@example.com`,
    name: "Late",
    target: subject(),
    adultAttested: true,
  });
  assert.ok(expired.outcome === "created");
  await db
    .updateTable("team_admin_invitation")
    .set({ expires_at: sql`now() - interval '1 minute'` })
    .where("id", "=", expired.id)
    .execute();

  const detail = await directoryTeam(actor, org);
  assert.ok(detail);
  assert.equal(detail.team.teamNumber, base + 2);
  assert.deepEqual(
    detail.administrators.map((a) => [a.memberId, a.name, a.webAccess, a.approvedAt !== null]),
    [
      [linked, "Linked", "linked", true],
      [approved, "Approved", "approved", true],
      [backend, "Backend", "none", false],
    ],
  );
  assert.ok(!detail.administrators.some((a) => a.memberId === scout));
  assert.deepEqual(
    detail.invitations.map((i) => [i.id, i.name, i.invitedByName, i.existingAccount, i.sent]),
    [[invited.id, "Riley", "Linked", false, false]],
  );
  // No email addresses or account IDs leave the database for this view.
  const payload = JSON.stringify(detail);
  assert.doesNotMatch(payload, /@example\.com/);
  assert.doesNotMatch(payload, /user_[A-Za-z0-9]+/);
  // Reading does not close expired invitations; that stays with the team's own list.
  const stored = await db
    .selectFrom("team_admin_invitation")
    .select("status")
    .where("id", "=", expired.id)
    .executeTakeFirstOrThrow();
  assert.equal(stored.status, "pending");

  // A demoted admin leaves the list.
  await db.updateTable("member").set({ role: "scout" }).where("id", "=", backend).execute();
  assert.equal((await directoryTeam(actor, org))?.administrators.length, 2);
  assert.equal(await directoryTeam(actor, randomUUID()), undefined);
});

test("keys list without secrets; only active keys reveal, only to current operators", async () => {
  const actor = await operator();
  const org = await team(base + 3);
  const other = await team(base + 4);
  const admin = await member(org, "admin", "Lead");
  const adminAccount = subject();
  await approveWebAdmin({ organizationId: org, memberId: admin, approverId: admin });
  await linkWebAdmin(org, admin, adminAccount);
  const active = await key(org, "Website", "scout_active_secret");
  const revoked = await key(org, "Old sheet", null);
  const foreign = await key(other, "Other team", "scout_other_secret");

  const detail = await directoryTeam(actor, org);
  assert.deepEqual(
    detail?.keys.map((k) => [k.id, k.name, k.revokedAt === null]),
    [
      [active, "Website", true],
      [revoked, "Old sheet", false],
    ],
  );
  assert.doesNotMatch(JSON.stringify(detail), /scout_active_secret|v1:/);

  const shown = await revealApiKeyCiphertext(actor, org, active);
  assert.ok(shown.outcome === "revealed");
  assert.equal(cipher.decrypt(shown.ciphertext), "scout_active_secret");
  assert.deepEqual(await revealApiKeyCiphertext(actor, org, revoked), { outcome: "revoked" });
  // A key is reachable only through its own team.
  assert.deepEqual(await revealApiKeyCiphertext(actor, org, foreign), { outcome: "not_found" });
  assert.deepEqual(await revealApiKeyCiphertext(actor, org, randomUUID()), {
    outcome: "not_found",
  });
  // The team's own admin uses the tenant-scoped team endpoints, not this one.
  assert.deepEqual(await revealApiKeyCiphertext(adminAccount, org, active), {
    outcome: "forbidden",
  });
  assert.deepEqual(await revealApiKeyCiphertext(subject(), org, active), { outcome: "forbidden" });

  // Removing operator status blocks the next request.
  assert.ok(await removeOperator(actor));
  assert.deepEqual(await revealApiKeyCiphertext(actor, org, active), { outcome: "forbidden" });
  assert.equal(await directoryTeam(actor, org), undefined);
  assert.deepEqual(await listDirectoryTeams(actor, "", 1), { teams: [], total: 0 });
  // Operators never needed or got a team membership.
  const memberships = await db
    .selectFrom("web_admin_access")
    .select("member_id")
    .where("clerk_user_id", "=", actor)
    .execute();
  assert.deepEqual(memberships, []);
});

test("the runtime role reads across teams only through the operator functions", async () => {
  const actor = await operator();
  const org = await team(base + 5);
  const active = await key(org, "Website", "scout_runtime_secret");
  const role = `operator_dir_test_${randomUUID().replaceAll("-", "")}`;
  await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(db);
  await sql`GRANT EXECUTE ON FUNCTION list_operator_teams(text, text, integer, integer), reveal_operator_api_key(text, uuid, uuid), lock_operator_api_key(text, uuid, uuid), complete_operator_api_key_revoke(text, uuid, uuid) TO ${sql.id(role)}`.execute(
    db,
  );
  const asRuntime = <T>(run: (tx: typeof db) => Promise<T>) =>
    db.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
      return run(tx);
    });
  try {
    await assert.rejects(
      asRuntime((tx) => tx.selectFrom("api_key").select("id").execute()),
      /permission denied/,
    );
    await assert.rejects(
      asRuntime((tx) => sql`select is_platform_operator(${actor})`.execute(tx)),
      /permission denied/,
    );
    const { rows } = await asRuntime((tx) =>
      sql<{
        id: string;
      }>`select id from list_operator_teams(${actor}, ${String(base + 5)}, 25, 0)`.execute(tx),
    );
    assert.deepEqual(
      rows.map((row) => row.id),
      [org],
    );
    const revealed = await asRuntime((tx) =>
      sql<{
        outcome: string;
      }>`select outcome from reveal_operator_api_key(${actor}, ${org}::uuid, ${active}::uuid)`.execute(
        tx,
      ),
    );
    assert.equal(revealed.rows[0]?.outcome, "revealed");
    await assert.rejects(
      asRuntime((tx) => tx.selectFrom("operator_team_action").select("id").execute()),
      /permission denied/,
    );
    // Revoke works through the functions alone, including the audit row.
    const revoked = await asRuntime(async (tx) => {
      await sql`select * from lock_operator_api_key(${actor}, ${org}::uuid, ${active}::uuid)`.execute(
        tx,
      );
      return sql<{
        done: boolean;
      }>`select complete_operator_api_key_revoke(${actor}, ${org}::uuid, ${active}::uuid) as done`.execute(
        tx,
      );
    });
    assert.equal(revoked.rows[0]?.done, true);
  } finally {
    await sql`DROP OWNED BY ${sql.id(role)}`.execute(db);
    await sql`DROP ROLE ${sql.id(role)}`.execute(db);
  }
});

const actions = (org: string) =>
  db
    .selectFrom("operator_team_action")
    .select(["operator", "action", "target_id"])
    .where("organization_id", "=", org)
    .orderBy("created_at")
    .execute();

test("operators revoke any key; the provider goes first and failures roll back", async () => {
  const actor = await operator();
  const org = await team(base + 6);
  const other = await team(base + 7);
  const admin = await member(org, "admin", "Lead");
  const adminAccount = subject();
  await approveWebAdmin({ organizationId: org, memberId: admin, approverId: admin });
  await linkWebAdmin(org, admin, adminAccount);
  const id = await key(org, "Website", "scout_revoke_me");
  const foreign = await key(other, "Other", "scout_other");
  const stored = await db
    .selectFrom("api_key")
    .select("provider_key_id")
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  const provider: string[] = [];
  const ok = async (keyId: string) => {
    provider.push(keyId);
  };

  // A provider failure leaves the key active and readable.
  await assert.rejects(
    revokeDirectoryApiKey(actor, org, id, async () => {
      throw Error("provider down");
    }),
  );
  assert.equal(await activeApiKey(org, stored.provider_key_id), true);
  assert.equal((await revealApiKeyCiphertext(actor, org, id)).outcome, "revealed");

  assert.equal(await revokeDirectoryApiKey(adminAccount, org, id, ok), "forbidden");
  assert.equal(await revokeDirectoryApiKey(subject(), org, id, ok), "forbidden");
  assert.equal(await revokeDirectoryApiKey(actor, org, foreign, ok), "not_found");
  assert.deepEqual(provider, []);

  assert.equal(await revokeDirectoryApiKey(actor, org, id, ok), "revoked");
  assert.deepEqual(provider, [stored.provider_key_id]);
  const row = await db
    .selectFrom("api_key")
    .select(["revoked_at", "revoked_by", "revoked_by_operator", "secret_ciphertext"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  assert.ok(row.revoked_at);
  assert.equal(row.revoked_by, null);
  assert.equal(row.revoked_by_operator, actor);
  assert.equal(row.secret_ciphertext, null);
  assert.equal(await activeApiKey(org, stored.provider_key_id), false);
  assert.deepEqual(await revealApiKeyCiphertext(actor, org, id), { outcome: "revoked" });
  // Repeats do not call the provider again.
  assert.equal(await revokeDirectoryApiKey(actor, org, id, ok), "already_revoked");
  assert.equal(provider.length, 1);
  assert.deepEqual(await actions(org), [
    { operator: actor, action: "revoke_api_key", target_id: id },
  ]);
  // The other team's key is untouched.
  assert.equal((await revealApiKeyCiphertext(actor, other, foreign)).outcome, "revealed");
});

test("operators remove any admin: web access ends, the member stays as a scout", async () => {
  const actor = await operator();
  const org = await team(base + 8);
  const lead = await member(org, "admin", "Lead");
  const second = await member(org, "admin", "Second");
  const leadAccount = subject();
  const secondAccount = subject();
  await approveWebAdmin({ organizationId: org, memberId: lead, approverId: lead });
  await linkWebAdmin(org, lead, leadAccount);
  await approveWebAdmin({ organizationId: org, memberId: second, approverId: lead });
  await linkWebAdmin(org, second, secondAccount);
  const invited = await createTeamAdminInvitation({
    actor: secondAccount,
    org,
    email: `${randomUUID()}@example.com`,
    name: "Riley",
    target: null,
    adultAttested: true,
  });
  assert.ok(invited.outcome === "created");
  await db
    .updateTable("team_admin_invitation")
    .set({ clerk_invitation_id: "inv_second" })
    .where("id", "=", invited.id)
    .execute();
  const kept = await createTeamAdminInvitation({
    actor: leadAccount,
    org,
    email: `${randomUUID()}@example.com`,
    name: "Kept",
    target: null,
    adultAttested: true,
  });
  assert.ok(kept.outcome === "created");

  assert.deepEqual(await removeDirectoryAdmin(leadAccount, org, second), { outcome: "forbidden" });
  assert.deepEqual(await removeDirectoryAdmin(subject(), org, second), { outcome: "forbidden" });
  assert.deepEqual(await removeDirectoryAdmin(actor, randomUUID(), second), {
    outcome: "not_found",
  });

  assert.deepEqual(await removeDirectoryAdmin(actor, org, second), {
    outcome: "removed",
    clerkInvitationIds: ["inv_second"],
  });
  const demoted = await db
    .selectFrom("member")
    .select("role")
    .where("id", "=", second)
    .executeTakeFirstOrThrow();
  assert.equal(demoted.role, "scout");
  assert.deepEqual(await adminOrganizations(secondAccount), []);
  assert.equal((await adminOrganizations(leadAccount)).length, 1);
  // The Telegram identity and member history stay.
  const identities = await db
    .selectFrom("channel_identity")
    .select("member_id")
    .where("member_id", "=", second)
    .execute();
  assert.equal(identities.length, 1);
  const invitation = await db
    .selectFrom("team_admin_invitation")
    .select(["status", "email"])
    .where("id", "=", invited.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(invitation, { status: "cancelled", email: null });
  // Other admins' invitations stay open.
  const other = await db
    .selectFrom("team_admin_invitation")
    .select("status")
    .where("id", "=", kept.id)
    .executeTakeFirstOrThrow();
  assert.equal(other.status, "pending");
  assert.deepEqual(
    (await directoryTeam(actor, org))?.administrators.map((a) => a.name),
    ["Lead"],
  );
  assert.deepEqual(await removeDirectoryAdmin(actor, org, second), { outcome: "not_found" });

  // The last admin can be removed too, including one with no web approval.
  assert.equal((await removeDirectoryAdmin(actor, org, lead)).outcome, "removed");
  const backendOnly = await member(org, "admin", "Backend");
  assert.deepEqual(await removeDirectoryAdmin(actor, org, backendOnly), {
    outcome: "removed",
    clerkInvitationIds: [],
  });
  assert.deepEqual((await directoryTeam(actor, org))?.administrators, []);
  assert.deepEqual(
    (await actions(org)).map((a) => [a.action, a.target_id]),
    [
      ["remove_admin", second],
      ["remove_admin", lead],
      ["remove_admin", backendOnly],
    ],
  );
});
