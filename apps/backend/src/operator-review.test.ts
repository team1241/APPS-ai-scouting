import assert from "node:assert/strict";
import { test } from "node:test";
import { type OperatorDeps, operatorRoutes } from "./operator-review.ts";

const id = "00000000-0000-4000-8000-000000000033";
const invitationId = "00000000-0000-4000-8000-000000000035";
const headers = { authorization: "Bearer session", "content-type": "application/json" };

function deps(overrides: Partial<OperatorDeps> = {}): OperatorDeps {
  return {
    verify: async (request) =>
      request.headers.get("authorization") === "Bearer session" ? "user_operator" : null,
    profile: async (subject) => (subject === "user_operator" ? { name: "Operator" } : undefined),
    applications: async () => [],
    approve: async () => ({
      outcome: "approved",
      organizationId: "00000000-0000-4000-8000-000000000001",
      memberId: "00000000-0000-4000-8000-000000000002",
      email: "lead@example.com",
    }),
    reject: async () => "rejected",
    invitable: async () => ({ id, email: "lead@example.com" }),
    recordInvitation: async () => true,
    operators: async () => [],
    grantOperator: async () => "added",
    revokeOperator: async () => "removed",
    invitations: async () => [],
    createInvitation: async () => ({ outcome: "created", id: invitationId }),
    recordOperatorInvitation: async () => true,
    openInvitation: async () => ({ email: "new@example.com", clerkInvitationId: "inv_old" }),
    revokeInvitation: async () => ({ outcome: "revoked", clerkInvitationId: "inv_old" }),
    accounts: {
      invite: async () => "inv_1",
      pendingClaim: async () => null,
      inviteOperator: async () => "inv_op",
      revokeInvitation: async () => {},
      findVerifiedUser: async () => "user_new",
    },
    ...overrides,
  };
}

test("operator routes require a verified session and a current operator record", async () => {
  assert.equal((await operatorRoutes(deps({ verify: null })).request("/applications")).status, 503);
  const app = operatorRoutes(deps());
  assert.equal((await app.request("/applications")).status, 401);
  const notOperator = operatorRoutes(deps({ profile: async () => undefined }));
  assert.equal((await notOperator.request("/applications", { headers })).status, 403);
  assert.equal(
    (await notOperator.request(`/applications/${id}/approve`, { method: "POST", headers })).status,
    403,
  );
  const response = await app.request("/", { headers });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { operator: { name: "Operator" } });
});

test("approval validates the team name, provisions, then sends the invitation", async () => {
  const calls: string[] = [];
  const app = operatorRoutes(
    deps({
      approve: async (subject, applicationId, name) => {
        calls.push(`approve:${subject}:${applicationId}:${name}`);
        return {
          outcome: "approved",
          organizationId: "00000000-0000-4000-8000-000000000001",
          memberId: "00000000-0000-4000-8000-000000000002",
          email: "lead@example.com",
        };
      },
      accounts: {
        invite: async (input) => {
          calls.push(`invite:${input.email}:${input.applicationId}:${input.resend}`);
          return "inv_1";
        },
        pendingClaim: async () => null,
        inviteOperator: async () => "inv_op",
        revokeInvitation: async () => {},
        findVerifiedUser: async () => null,
      },
      recordInvitation: async (_subject, applicationId, invitationId) => {
        calls.push(`record:${applicationId}:${invitationId}`);
        return true;
      },
    }),
  );
  const approve = (body: unknown, target = id) =>
    app.request(`/applications/${target}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  for (const organizationName of ["", " ", "x".repeat(121), "a\nb", 5])
    assert.equal((await approve({ organizationName })).status, 400);
  assert.equal((await approve({ organizationName: "Theory6" }, "nope")).status, 404);
  const response = await approve({ organizationName: "  Theory6  " });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    organizationId: "00000000-0000-4000-8000-000000000001",
    invitation: "sent",
  });
  assert.deepEqual(calls, [
    `approve:user_operator:${id}:Theory6`,
    `invite:lead@example.com:${id}:false`,
    `record:${id}:inv_1`,
  ]);
});

test("review conflicts and invitation failures return safe, specific results", async () => {
  for (const outcome of ["not_pending", "team_exists"] as const) {
    const app = operatorRoutes(deps({ approve: async () => ({ outcome }) }));
    const response = await app.request(`/applications/${id}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ organizationName: "Theory6" }),
    });
    assert.equal(response.status, 409);
  }
  const failing = operatorRoutes(
    deps({
      accounts: {
        invite: async () => {
          throw Error("Clerk: lead@example.com already exists");
        },
        pendingClaim: async () => null,
        inviteOperator: async () => "inv_op",
        revokeInvitation: async () => {},
        findVerifiedUser: async () => null,
      },
      recordInvitation: async () => assert.fail("failed invitation recorded"),
    }),
  );
  const approved = await failing.request(`/applications/${id}/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ organizationName: "Theory6" }),
  });
  assert.equal((await approved.json()).invitation, "failed");
  const retry = await failing.request(`/applications/${id}/invitation`, {
    method: "POST",
    headers,
  });
  assert.deepEqual(await retry.json(), { invitation: "failed" });
  const noClerk = operatorRoutes(deps({ accounts: null }));
  const unavailable = await noClerk.request(`/applications/${id}/invitation`, {
    method: "POST",
    headers,
  });
  assert.deepEqual(await unavailable.json(), { invitation: "unavailable" });
  const reviewed = operatorRoutes(
    deps({ reject: async () => "not_pending", invitable: async () => undefined }),
  );
  assert.equal(
    (await reviewed.request(`/applications/${id}/reject`, { method: "POST", headers })).status,
    409,
  );
  assert.equal(
    (await reviewed.request(`/applications/${id}/invitation`, { method: "POST", headers })).status,
    409,
  );
  const broken = operatorRoutes(
    deps({
      applications: async () => {
        throw Error("SQL and applicant details");
      },
    }),
  );
  const error = await broken.request("/applications", { headers });
  assert.equal(error.status, 503);
  assert.deepEqual(await error.json(), { error: "Application review unavailable" });
});

test("operators list, add by verified email and remove others", async () => {
  const calls: string[] = [];
  const app = operatorRoutes(
    deps({
      operators: async () => [
        {
          clerkUserId: "user_operator",
          name: "Operator",
          createdAt: "2026-11-08T00:00:00.000Z",
          addedByName: null,
        },
        {
          clerkUserId: "user_other",
          name: "Other",
          createdAt: "2026-11-08T00:00:00.000Z",
          addedByName: "Operator",
        },
      ],
      grantOperator: async (subject, target, name) => {
        calls.push(`grant:${subject}:${target}:${name}`);
        return "added";
      },
      accounts: {
        invite: async () => "inv_1",
        pendingClaim: async () => null,
        inviteOperator: async () => "inv_op",
        revokeInvitation: async () => {},
        findVerifiedUser: async (email) => {
          calls.push(`lookup:${email}`);
          return email === "new@example.com" ? "user_new" : null;
        },
      },
    }),
  );
  const list = await (await app.request("/operators", { headers })).json();
  assert.deepEqual(
    list.operators.map((o: { clerkUserId: string; isSelf: boolean }) => [o.clerkUserId, o.isSelf]),
    [
      ["user_operator", true],
      ["user_other", false],
    ],
  );
  const add = (body: unknown) =>
    app.request("/operators", { method: "POST", headers, body: JSON.stringify(body) });
  for (const body of [
    { name: "", email: "new@example.com" },
    { name: "New", email: "bad" },
    { name: 5, email: "new@example.com" },
    { name: "a\nb", email: "new@example.com" },
  ])
    assert.equal((await add(body)).status, 400);
  const missing = await add({ name: "Nobody", email: "missing@example.com" });
  assert.equal(missing.status, 202);
  assert.deepEqual(await missing.json(), { invited: true });
  assert.equal((await add({ name: " New ", email: " NEW@example.com " })).status, 201);
  assert.deepEqual(calls, [
    "lookup:missing@example.com",
    "lookup:new@example.com",
    "grant:user_operator:user_new:New",
  ]);
  assert.equal(
    (await app.request("/operators/not-an-id", { method: "DELETE", headers })).status,
    404,
  );
  assert.equal(
    (await app.request("/operators/user_other", { method: "DELETE", headers })).status,
    200,
  );
});

test("operator management conflicts and missing Clerk configuration", async () => {
  const exists = operatorRoutes(deps({ grantOperator: async () => "exists" }));
  const add = await exists.request("/operators", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Dup", email: "dup@example.com" }),
  });
  assert.equal(add.status, 409);
  const noClerk = operatorRoutes(deps({ accounts: null }));
  assert.equal(
    (
      await noClerk.request("/operators", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "X", email: "x@example.com" }),
      })
    ).status,
    503,
  );
  for (const [outcome, status] of [
    ["self", 409],
    ["not_found", 404],
    ["forbidden", 403],
  ] as const) {
    const app = operatorRoutes(deps({ revokeOperator: async () => outcome }));
    assert.equal(
      (await app.request("/operators/user_x", { method: "DELETE", headers })).status,
      status,
    );
  }
  const notOperator = operatorRoutes(deps({ profile: async () => undefined }));
  assert.equal(
    (await notOperator.request("/operators/user_x", { method: "DELETE", headers })).status,
    403,
  );
});

test("people without an account get a 7-day operator invitation; failures close it", async () => {
  const calls: string[] = [];
  const recorder = (overrides: Partial<OperatorDeps> = {}) =>
    operatorRoutes(
      deps({
        createInvitation: async (_subject, email, name) => {
          calls.push(`create:${email}:${name}`);
          return { outcome: "created", id: invitationId };
        },
        recordOperatorInvitation: async (_subject, id, clerkId) => {
          calls.push(`record:${id}:${clerkId}`);
          return true;
        },
        revokeInvitation: async (_subject, id) => {
          calls.push(`revoke:${id}`);
          return { outcome: "revoked", clerkInvitationId: null };
        },
        accounts: {
          invite: async () => "inv_1",
          pendingClaim: async () => null,
          findVerifiedUser: async () => null,
          inviteOperator: async ({ email, invitationId: id }) => {
            calls.push(`clerk:${email}:${id}`);
            return "inv_op";
          },
          revokeInvitation: async (clerkId) => {
            calls.push(`clerk-revoke:${clerkId}`);
          },
        },
        ...overrides,
      }),
    );
  const post = (app: ReturnType<typeof operatorRoutes>) =>
    app.request("/operators", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "New Operator", email: "New@Example.com" }),
    });
  assert.equal((await post(recorder())).status, 202);
  assert.deepEqual(calls, [
    "create:new@example.com:New Operator",
    `clerk:new@example.com:${invitationId}`,
    `record:${invitationId}:inv_op`,
  ]);
  calls.length = 0;
  const exists = await post(recorder({ createInvitation: async () => ({ outcome: "exists" }) }));
  assert.equal(exists.status, 409);
  assert.match((await exists.json()).errors.email, /open invitation/);
  const clerkDown = recorder({
    accounts: {
      invite: async () => "inv_1",
      pendingClaim: async () => null,
      findVerifiedUser: async () => null,
      inviteOperator: async () => {
        throw Error("Clerk details");
      },
      revokeInvitation: async () => {},
    },
  });
  calls.length = 0;
  const failed = await post(clerkDown);
  assert.equal(failed.status, 502);
  assert.ok(calls.includes(`revoke:${invitationId}`));
});

test("operators list, resend and cancel invitations", async () => {
  const calls: string[] = [];
  const app = operatorRoutes(
    deps({
      invitations: async () => [
        {
          id: invitationId,
          email: "new@example.com",
          name: "New",
          invitedByName: "Operator",
          createdAt: "2026-11-09T00:00:00.000Z",
          expiresAt: "2026-11-16T00:00:00.000Z",
          sent: true,
        },
      ],
      recordOperatorInvitation: async (_subject, id, clerkId) => {
        calls.push(`record:${id}:${clerkId}`);
        return true;
      },
      accounts: {
        invite: async () => "inv_1",
        pendingClaim: async () => null,
        findVerifiedUser: async () => null,
        inviteOperator: async () => {
          calls.push("clerk:invite");
          return "inv_new";
        },
        revokeInvitation: async (clerkId) => {
          calls.push(`clerk-revoke:${clerkId}`);
        },
      },
    }),
  );
  const list = await (await app.request("/operator-invitations", { headers })).json();
  assert.equal(list.invitations[0].id, invitationId);
  assert.equal(
    (await app.request("/operator-invitations/bad/resend", { method: "POST", headers })).status,
    404,
  );
  const resend = await app.request(`/operator-invitations/${invitationId}/resend`, {
    method: "POST",
    headers,
  });
  assert.equal(resend.status, 200);
  assert.deepEqual(calls, [
    "clerk-revoke:inv_old",
    "clerk:invite",
    `record:${invitationId}:inv_new`,
  ]);
  calls.length = 0;
  const cancel = await app.request(`/operator-invitations/${invitationId}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(cancel.status, 200);
  assert.deepEqual(calls, ["clerk-revoke:inv_old"]);
  const gone = operatorRoutes(
    deps({
      openInvitation: async () => undefined,
      revokeInvitation: async () => ({ outcome: "not_found", clerkInvitationId: null }),
    }),
  );
  assert.equal(
    (
      await gone.request(`/operator-invitations/${invitationId}/resend`, {
        method: "POST",
        headers,
      })
    ).status,
    404,
  );
  assert.equal(
    (await gone.request(`/operator-invitations/${invitationId}`, { method: "DELETE", headers }))
      .status,
    404,
  );
});
