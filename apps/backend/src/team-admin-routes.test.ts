import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClerkAccounts } from "./clerk-accounts.ts";
import type { TeamAdminDeps } from "./team-admin-routes.ts";
import { webAdminRoutes } from "./web-admin.ts";

const org = "00000000-0000-4000-8000-000000000040";
const otherOrg = "00000000-0000-4000-8000-000000000041";
const invitationId = "00000000-0000-4000-8000-000000000042";
const headers = { authorization: "Bearer session", "content-type": "application/json" };
const body = (value: unknown) => ({ method: "POST", headers, body: JSON.stringify(value) });
const valid = { name: "Riley", email: "Riley@Example.com", adultAttested: true };

function accounts(overrides: Partial<ClerkAccounts> = {}): ClerkAccounts {
  return {
    invite: async () => "inv_app",
    inviteOperator: async () => "inv_op",
    inviteTeamAdmin: async () => "inv_team",
    revokeInvitation: async () => {},
    pendingClaim: async () => null,
    verifiedEmails: async () => ["riley@example.com"],
    findVerifiedUser: async () => null,
    ...overrides,
  };
}

// The admin "user_admin" administers `org` only.
function deps(overrides: Partial<TeamAdminDeps> = {}): TeamAdminDeps {
  return {
    admins: async (subject, id) =>
      subject === "user_admin" && id === org
        ? [
            {
              memberId: "m1",
              name: "Lead",
              linked: true,
              isSelf: true,
              approvedAt: "2026-11-09T00:00:00.000Z",
            },
          ]
        : [],
    invitations: async () => [],
    create: async ({ actor, org: id }) =>
      actor === "user_admin" && id === org
        ? { outcome: "created", id: invitationId }
        : { outcome: "forbidden" },
    record: async () => true,
    resend: async () => ({
      outcome: "resent",
      id: "00000000-0000-4000-8000-000000000043",
      email: "riley@example.com",
      existingAccount: false,
      previousClerkInvitationId: "inv_old",
    }),
    cancel: async () => ({ outcome: "cancelled", clerkInvitationId: "inv_old" }),
    accountInvitations: async () => [],
    accept: async () => ({ outcome: "accepted", organizationId: org }),
    accounts: accounts(),
    ...overrides,
  };
}

function app(team: TeamAdminDeps, subject = "user_admin") {
  return webAdminRoutes({
    verify: async (request) =>
      request.headers.get("authorization") === "Bearer session" ? subject : null,
    organizations: async () => [],
    claim: null,
    teamAdmins: team,
  });
}

test("administrator routes need a session and current admin access to the named team", async () => {
  const routes = app(deps());
  assert.equal((await routes.request(`/organizations/${org}/administrators`)).status, 401);
  const listed = await routes.request(`/organizations/${org}/administrators`, { headers });
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), "private, no-store");
  assert.equal((await listed.json()).administrators.length, 1);
  // Another team, a forged ID and a non-admin all look like a missing team.
  for (const path of [
    `/organizations/${otherOrg}/administrators`,
    "/organizations/not-a-uuid/administrators",
  ])
    assert.equal((await routes.request(path, { headers })).status, 404);
  const outsider = app(deps(), "user_outsider");
  assert.equal(
    (await outsider.request(`/organizations/${org}/administrators`, { headers })).status,
    404,
  );
  let looked = false;
  const lookups = deps({
    accounts: accounts({
      findVerifiedUser: async () => {
        looked = true;
        return null;
      },
    }),
  });
  const forged = await app(lookups, "user_outsider").request(
    `/organizations/${org}/administrators/invitations`,
    body(valid),
  );
  assert.equal(forged.status, 404);
  assert.equal(looked, false);
});

test("invitations validate the name, email and adult attestation", async () => {
  const routes = app(deps());
  const path = `/organizations/${org}/administrators/invitations`;
  const response = await routes.request(
    path,
    body({ name: " ", email: "x", adultAttested: "yes" }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(Object.keys((await response.json()).errors).sort(), [
    "adultAttested",
    "email",
    "name",
  ]);
  const large = await routes.request(path, body({ ...valid, name: "x".repeat(2000) }));
  assert.equal(large.status, 413);
  const noClerk = app(deps({ accounts: null }));
  assert.equal((await noClerk.request(path, body(valid))).status, 503);
});

test("a new email gets a Clerk invitation; an existing account gets none", async () => {
  const calls: string[] = [];
  const path = `/organizations/${org}/administrators/invitations`;
  const emailInvite = app(
    deps({
      create: async (input) => {
        calls.push(`create:${input.email}:${input.target}:${input.adultAttested}`);
        return { outcome: "created", id: invitationId };
      },
      record: async (_s, _o, id, clerkId) => {
        calls.push(`record:${id}:${clerkId}`);
        return true;
      },
      accounts: accounts({
        inviteTeamAdmin: async ({ email, invitationId: id }) => {
          calls.push(`clerk:${email}:${id}`);
          return "inv_team";
        },
      }),
    }),
  );
  const sent = await emailInvite.request(path, body(valid));
  assert.equal(sent.status, 201);
  assert.deepEqual(await sent.json(), { invitation: "email" });
  assert.deepEqual(calls, [
    "create:riley@example.com:null:true",
    `clerk:riley@example.com:${invitationId}`,
    `record:${invitationId}:inv_team`,
  ]);

  calls.length = 0;
  const existing = app(
    deps({
      create: async (input) => {
        calls.push(`create:${input.target}`);
        return { outcome: "created", id: invitationId };
      },
      accounts: accounts({
        findVerifiedUser: async () => "user_existing",
        inviteTeamAdmin: async () => assert.fail("existing accounts get no Clerk invitation"),
      }),
    }),
  );
  const bound = await existing.request(path, body(valid));
  assert.equal(bound.status, 201);
  assert.deepEqual(await bound.json(), { invitation: "account" });
  assert.deepEqual(calls, ["create:user_existing"]);

  for (const [outcome, message] of [
    ["already_admin", "This person is already an administrator of this team."],
    ["exists", "This email already has a pending invitation."],
  ] as const) {
    const conflict = await app(deps({ create: async () => ({ outcome }) })).request(
      path,
      body(valid),
    );
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { errors: { email: message } });
  }
});

test("a failed Clerk delivery cancels the invitation and is never reported as sent", async () => {
  const calls: string[] = [];
  const routes = app(
    deps({
      cancel: async (_s, _o, id) => {
        calls.push(`cancel:${id}`);
        return { outcome: "cancelled", clerkInvitationId: null };
      },
      record: async () => assert.fail("failed invitation recorded"),
      accounts: accounts({
        inviteTeamAdmin: async () => {
          throw Error("Clerk: riley@example.com already invited");
        },
      }),
    }),
  );
  const response = await routes.request(
    `/organizations/${org}/administrators/invitations`,
    body(valid),
  );
  assert.equal(response.status, 502);
  const json = await response.json();
  assert.match(json.error, /couldn’t send/);
  assert.doesNotMatch(json.error, /riley@example\.com/);
  assert.deepEqual(calls, [`cancel:${invitationId}`]);
});

test("resend replaces the Clerk invitation, and cancel revokes it after closing the record", async () => {
  const calls: string[] = [];
  const resent = "00000000-0000-4000-8000-000000000043";
  const routes = app(
    deps({
      record: async (_s, _o, id, clerkId) => {
        calls.push(`record:${id}:${clerkId}`);
        return true;
      },
      cancel: async (_s, _o, id) => {
        calls.push(`cancel:${id}`);
        return { outcome: "cancelled", clerkInvitationId: "inv_open" };
      },
      accounts: accounts({
        revokeInvitation: async (id) => {
          calls.push(`clerk-revoke:${id}`);
        },
        inviteTeamAdmin: async ({ invitationId: id }) => {
          calls.push(`clerk:${id}`);
          return "inv_new";
        },
      }),
    }),
  );
  const base = `/organizations/${org}/administrators/invitations/${invitationId}`;
  const sent = await routes.request(`${base}/resend`, { method: "POST", headers });
  assert.equal(sent.status, 200);
  assert.deepEqual(calls, ["clerk-revoke:inv_old", `clerk:${resent}`, `record:${resent}:inv_new`]);
  calls.length = 0;
  const cancelled = await routes.request(base, { method: "DELETE", headers });
  assert.equal(cancelled.status, 200);
  assert.deepEqual(calls, [`cancel:${invitationId}`, "clerk-revoke:inv_open"]);

  const failing = app(
    deps({
      accounts: accounts({
        inviteTeamAdmin: async () => {
          throw Error("Clerk down");
        },
      }),
    }),
  );
  assert.equal((await failing.request(`${base}/resend`, { method: "POST", headers })).status, 502);
  const missing = app(deps({ resend: async () => ({ outcome: "not_found" }) }));
  assert.equal((await missing.request(`${base}/resend`, { method: "POST", headers })).status, 404);
  const forbidden = app(
    deps({ cancel: async () => ({ outcome: "forbidden", clerkInvitationId: null }) }),
  );
  assert.equal((await forbidden.request(base, { method: "DELETE", headers })).status, 404);
});

test("accepting uses the session account and its Clerk-verified emails only", async () => {
  const calls: unknown[] = [];
  const routes = app(
    deps({
      accept: async (...args) => {
        calls.push(args);
        return { outcome: "accepted", organizationId: org };
      },
    }),
    "user_invited",
  );
  const path = `/administrator-invitations/${invitationId}/accept`;
  const accepted = await routes.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify({ subject: "user_victim", emails: ["forged@example.com"] }),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { organizationId: org, outcome: "accepted" });
  assert.deepEqual(calls, [["user_invited", invitationId, ["riley@example.com"], false]]);
  const gone = app(deps({ accept: async () => ({ outcome: "unavailable" }) }));
  const response = await gone.request(path, { method: "POST", headers });
  assert.equal(response.status, 409);
  assert.equal(
    (await app(deps()).request("/administrator-invitations/x/accept", { method: "POST", headers }))
      .status,
    404,
  );
});
