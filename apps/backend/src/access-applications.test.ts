import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { accessApplicationRoutes } from "./access-applications.ts";

const valid = () => ({
  id: randomUUID(),
  name: "  Avery Mentor  ",
  email: " Avery@example.com ",
  teamNumber: "1241",
  role: "lead_mentor",
  adultAttested: true,
});
const post = (input: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
});

test("public applications validate and normalize before saving, without granting access or exposing records", async () => {
  let saved = 0;
  const input = valid();
  const app = accessApplicationRoutes({
    save: async (application) => {
      saved++;
      assert.deepEqual(application, {
        ...input,
        name: "Avery Mentor",
        email: "avery@example.com",
        teamNumber: 1241,
      });
      return "received";
    },
  });
  const response = await app.request("/", post(input));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(saved, 1);
  assert.equal((await app.request("/")).status, 404);
  assert.equal((await app.request(`/${input.id}`)).status, 404);
});

test("every requested field is validated, including strict adult attestation and team-role choices", async () => {
  const app = accessApplicationRoutes({
    save: async () => assert.fail("invalid application saved"),
  });
  const invalid: Record<string, unknown[]> = {
    id: ["", "not-a-uuid"],
    name: ["", " ", "x".repeat(121), "name\nprivate"],
    email: ["bad", "a@b", `${"x".repeat(250)}@test.com`, "a\u0000@test.com"],
    teamNumber: ["0", "-1", "1.5", "1e3", "00001", "100000", "", 1241],
    role: ["admin", "scout", "", ["mentor", "teacher"]],
    adultAttested: [false, "true", "on", null],
  };
  for (const [key, values] of Object.entries(invalid))
    for (const value of values) {
      const response = await app.request("/", post({ ...valid(), [key]: value }));
      assert.equal(response.status, 400, `${key}: ${JSON.stringify(value)}`);
      assert.ok((await response.json()).errors[key]);
    }
  for (const body of [null, [], {}, "text"])
    assert.equal((await app.request("/", post(body))).status, 400);
});

test("all four roles are accepted; oversized, malformed and failing requests return safe errors", async () => {
  const good = accessApplicationRoutes({ save: async () => "received" });
  for (const role of ["mentor", "lead_mentor", "teacher", "other"])
    assert.equal((await good.request("/", post({ ...valid(), role }))).status, 202);
  assert.equal((await good.request("/", { method: "POST", body: "{" })).status, 400);
  assert.equal((await good.request("/", post({ ...valid(), name: "x".repeat(5000) }))).status, 413);
  const failing = accessApplicationRoutes({
    save: async () => {
      throw new Error("private name/email and SQL details");
    },
  });
  const response = await failing.request("/", post(valid()));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Applications are temporarily unavailable." });
});

test("a team with an earlier application or organization gets an explicit team-number error", async () => {
  const app = accessApplicationRoutes({ save: async () => "team_exists" });
  const response = await app.request("/", post(valid()));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.errors.teamNumber, /already has an application/);
  assert.equal(body.received, undefined);
});
