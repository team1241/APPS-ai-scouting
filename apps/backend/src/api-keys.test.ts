import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { apiKeyConfig, ProviderUnavailable, secretCipher, unkeyProvider } from "./api-keys.ts";
import { dataApiRoutes } from "./data-api.ts";
import { webAdminRoutes } from "./web-admin.ts";

const org = "00000000-0000-4000-8000-000000000020";
const other = "00000000-0000-4000-8000-000000000021";
const keyId = "00000000-0000-4000-8000-000000000030";
const organization = { id: org, name: "Team 1241", teamNumber: 1241 };

test("secrets round-trip through authenticated encryption and reject tampering", () => {
  const cipher = secretCipher(randomBytes(32).toString("base64"));
  const sealed = cipher.encrypt("scout_secret");
  assert.ok(!sealed.includes("scout_secret"));
  assert.equal(cipher.decrypt(sealed), "scout_secret");
  assert.notEqual(cipher.encrypt("scout_secret"), sealed);
  const [version, iv, tag, body] = sealed.split(":");
  assert.throws(() => cipher.decrypt([version, iv, tag, `A${body?.slice(1)}`].join(":")));
  assert.throws(() => secretCipher(randomBytes(16).toString("base64")));
});

test("configuration requires Unkey and an encryption key", () => {
  assert.equal(apiKeyConfig({}), null);
  const env = {
    UNKEY_ROOT_KEY: "root",
    UNKEY_API_ID: "api_test",
    API_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
  assert.equal(apiKeyConfig(env)?.ratePerMinute, 60);
  assert.throws(() => apiKeyConfig({ ...env, API_KEY_RATE_LIMIT_PER_MINUTE: "0" }));
});

test("the Unkey client binds keys to the organization and fails closed", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let reply: { status: number; body?: unknown } = { status: 200 };
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer root");
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  }) as typeof fetch;
  const provider = unkeyProvider("root", "api_test", fetcher);

  reply = { status: 200, body: { data: { keyId: "key_1", key: "scout_abc" } } };
  assert.deepEqual(await provider.create({ organizationId: org, ratePerMinute: 30 }), {
    keyId: "key_1",
    key: "scout_abc",
  });
  assert.equal(calls[0]?.url, "https://api.unkey.com/v2/keys.createKey");
  assert.deepEqual(calls[0]?.body, {
    apiId: "api_test",
    prefix: "scout",
    externalId: org,
    ratelimits: [{ name: "requests", limit: 30, duration: 60_000, autoApply: true }],
  });

  reply = {
    status: 200,
    body: { data: { valid: true, code: "VALID", keyId: "key_1", identity: { externalId: org } } },
  };
  assert.deepEqual(await provider.verify("scout_abc"), {
    valid: true,
    keyId: "key_1",
    organizationId: org,
  });
  for (const code of ["NOT_FOUND", "DISABLED", "USAGE_EXCEEDED", "EXPIRED"]) {
    reply = { status: 200, body: { data: { valid: false, code } } };
    assert.deepEqual(await provider.verify("scout_abc"), { valid: false, code: "invalid" });
  }
  reply = { status: 200, body: { data: { valid: false, code: "RATE_LIMITED" } } };
  assert.deepEqual(await provider.verify("scout_abc"), { valid: false, code: "rate_limited" });
  // A valid key without an organization binding grants nothing.
  reply = { status: 200, body: { data: { valid: true, code: "VALID", keyId: "key_1" } } };
  assert.deepEqual(await provider.verify("scout_abc"), { valid: false, code: "invalid" });

  for (const status of [401, 429, 500]) {
    reply = { status };
    await assert.rejects(provider.verify("scout_abc"), ProviderUnavailable);
    await assert.rejects(
      provider.create({ organizationId: org, ratePerMinute: 1 }),
      ProviderUnavailable,
    );
  }
  reply = { status: 404 };
  await provider.revoke("key_1");
  reply = { status: 500 };
  await assert.rejects(provider.revoke("key_1"), ProviderUnavailable);
  const offline = unkeyProvider("root", "api_test", (async () => {
    throw Error("network");
  }) as typeof fetch);
  await assert.rejects(offline.verify("scout_abc"), ProviderUnavailable);
});

test("the data API serves only the verified key's organization", async () => {
  let verification: () => Promise<unknown> = async () => ({
    valid: true,
    keyId: "key_1",
    organizationId: org,
  });
  let active = true;
  const app = dataApiRoutes({
    verify: () => verification() as never,
    active: async (verified, providerKeyId) => {
      assert.equal(verified, org);
      assert.equal(providerKeyId, "key_1");
      return active;
    },
    organization: async (id) => (id === org ? organization : undefined),
  });
  const get = (headers: Record<string, string> = { authorization: "Bearer scout_abc" }) =>
    app.request(`/organization?organizationId=${other}`, { headers });

  assert.equal((await get({})).status, 401);
  const ok = await get();
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { organization });
  assert.equal(ok.headers.get("cache-control"), "private, no-store");

  active = false;
  assert.equal((await get()).status, 401);
  active = true;
  verification = async () => ({ valid: true, keyId: "key_1", organizationId: "not-a-uuid" });
  assert.equal((await get()).status, 401);
  verification = async () => ({ valid: false, code: "invalid" });
  assert.equal((await get()).status, 401);
  verification = async () => ({ valid: false, code: "rate_limited" });
  assert.equal((await get()).status, 429);
  verification = async () => {
    throw new ProviderUnavailable("quota");
  };
  const down = await get();
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { error: "API key verification is unavailable" });

  const unconfigured = dataApiRoutes({
    verify: null,
    active: async () => true,
    organization: async () => organization,
  });
  assert.equal((await unconfigured.request("/organization")).status, 503);
});

test("key management requires a team admin session; data keys cannot manage keys", async () => {
  const key = {
    id: keyId,
    name: "Website",
    start: "scout_abcd",
    secret: "scout_abcdef",
    rateLimitPerMinute: 60,
    createdAt: "2026-11-09T00:00:00.000Z",
  };
  const admin = (o: string, subject: string) => o === org && subject === "user_admin";
  let limit = false;
  const app = webAdminRoutes({
    verify: async (request) =>
      ({ "Bearer admin": "user_admin", "Bearer scout": "user_scout" })[
        request.headers.get("authorization") ?? ""
      ] ?? null,
    organizations: async () => [],
    claim: null,
    apiKeys: {
      list: async (o, s) => (admin(o, s) ? [key] : null),
      create: async (o, s, name) => (admin(o, s) ? (limit ? "limit" : { ...key, name }) : null),
      revoke: async (o, s, id) => (admin(o, s) ? id === keyId : null),
    },
  });
  const request = (path: string, token: string, body?: unknown) =>
    app.request(`/organizations/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  assert.deepEqual(await (await request(`${org}/api-keys`, "admin")).json(), { keys: [key] });
  assert.equal((await request(`${org}/api-keys`, "scout_abcdef")).status, 401);
  assert.equal((await request(`${org}/api-keys`, "scout")).status, 404);
  assert.equal((await request(`${other}/api-keys`, "admin")).status, 404);
  assert.equal((await request("not-a-uuid/api-keys", "admin")).status, 404);

  const created = await request(`${org}/api-keys`, "admin", { name: "  Strategy sheet " });
  assert.equal(created.status, 201);
  assert.equal(((await created.json()) as { key: { name: string } }).key.name, "Strategy sheet");
  assert.equal((await request(`${org}/api-keys`, "admin", { name: " " })).status, 400);
  assert.equal((await request(`${org}/api-keys`, "admin", { name: "x".repeat(61) })).status, 400);
  assert.equal((await request(`${org}/api-keys`, "scout", { name: "Website" })).status, 404);
  limit = true;
  assert.equal((await request(`${org}/api-keys`, "admin", { name: "Website" })).status, 409);

  assert.equal((await request(`${org}/api-keys/${keyId}/revoke`, "admin", {})).status, 200);
  assert.equal((await request(`${org}/api-keys/${other}/revoke`, "admin", {})).status, 404);
  assert.equal((await request(`${org}/api-keys/${keyId}/revoke`, "scout", {})).status, 404);

  const unconfigured = webAdminRoutes({
    verify: async () => "user_admin",
    organizations: async () => [],
    claim: null,
    apiKeys: null,
  });
  const result = await unconfigured.request(`/organizations/${org}/api-keys`, {
    headers: { authorization: "Bearer admin" },
  });
  assert.equal(result.status, 503);
});
