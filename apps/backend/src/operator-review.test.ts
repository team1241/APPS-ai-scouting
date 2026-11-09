import assert from "node:assert/strict";
import { test } from "node:test";
import { type OperatorDeps, operatorRoutes } from "./operator-review.ts";

const id = "00000000-0000-4000-8000-000000000033";
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
    accounts: { invite: async () => "inv_1", pendingClaim: async () => null },
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
