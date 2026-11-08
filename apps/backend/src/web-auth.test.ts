import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { webSessionVerifier } from "./web-auth.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const issuer = "https://clerk.test.invalid";
const origin = "https://admin.test.invalid";
const now = Math.floor(Date.now() / 1000);
const payload = {
  sub: "user_approved",
  sid: "sess_test",
  iss: issuer,
  azp: origin,
  iat: now,
  nbf: now - 10,
  exp: now + 60,
};
function token(claims: Record<string, unknown>) {
  const data = [{ alg: "RS256", typ: "JWT", kid: "test-key" }, claims]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
const env = {
  CLERK_JWT_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
  CLERK_ISSUER: issuer,
  WEB_ORIGINS: origin,
};

test("verifies signed browser sessions and rejects wrong issuer/origin, expired and forged tokens", async () => {
  const verify = webSessionVerifier(env);
  assert.ok(verify);
  const request = (jwt: string) =>
    new Request("https://backend.test.invalid/web/organizations", {
      headers: { authorization: `Bearer ${jwt}` },
    });
  assert.equal(await verify(request(token(payload))), "user_approved");
  for (const claims of [
    { ...payload, iss: "https://attacker.invalid" },
    { ...payload, azp: "https://attacker.invalid" },
    { ...payload, exp: now - 120 },
    { ...payload, nbf: now + 120 },
    { ...payload, sid: undefined },
    { ...payload, sub: "telegram_123456" },
    { ...payload, azp: undefined },
  ])
    assert.equal(await verify(request(token(claims))), null);
  const forged = token(payload).split(".");
  forged[1] = Buffer.from(JSON.stringify({ ...payload, sub: "user_victim" })).toString("base64url");
  assert.equal(await verify(request(forged.join("."))), null);
  assert.equal(await verify(request("ak_machine_key")), null);
  assert.equal(await verify(new Request("https://backend.test.invalid")), null);
  assert.equal(webSessionVerifier({}), null);
});
