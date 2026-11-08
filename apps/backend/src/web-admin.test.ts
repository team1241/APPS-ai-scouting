import assert from "node:assert/strict";
import { test } from "node:test";
import { webAdminRoutes } from "./web-admin.ts";

const id = "00000000-0000-4000-8000-000000000020";
const organization = { id, name: "Team 1241", teamNumber: 1241 };
test("web administration fails closed and uses the verified session subject", async () => {
  let subject = "user_approved";
  let allowed = true;
  const app = webAdminRoutes({
    verify: async (request) =>
      request.headers.get("authorization") === "Bearer test-session" ? subject : null,
    organizations: async (verified) => {
      assert.equal(verified, subject);
      return allowed ? [organization] : [];
    },
  });
  const headers = { authorization: "Bearer test-session" };
  assert.equal((await app.request("/organizations")).status, 401);
  const result = await app.request("/organizations?subject=user_victim", { headers });
  assert.deepEqual(await result.json(), { organizations: [organization] });
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal((await app.request(`/organizations/${id}`, { headers })).status, 200);
  assert.equal(
    (await app.request("/organizations/00000000-0000-4000-8000-000000000021", { headers })).status,
    404,
  );
  allowed = false;
  assert.equal((await app.request(`/organizations/${id}`, { headers })).status, 404);
  subject = "user_scout";
  assert.deepEqual(await (await app.request("/organizations", { headers })).json(), {
    organizations: [],
  });
});

test("missing configuration and backend failure return generic errors without content", async () => {
  const unavailable = webAdminRoutes({ verify: null, organizations: async () => [] });
  assert.equal((await unavailable.request("/organizations")).status, 503);
  const failing = webAdminRoutes({
    verify: async () => "user_test",
    organizations: async () => {
      throw Error("private profile and database details");
    },
  });
  const result = await failing.request("/organizations");
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: "Administration unavailable" });
});
