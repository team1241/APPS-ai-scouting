import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { type ApiKeyConfig, type ApiKeyProvider, secretCipher } from "./api-keys.ts";
import { db } from "./db.ts";
import {
  activeApiKey,
  createApiKey,
  listApiKeys,
  MAX_ACTIVE_KEYS,
  revokeApiKey,
} from "./repositories/api-keys.ts";
import { enrollMember } from "./repositories/members.ts";
import { approveWebAdmin, linkWebAdmin } from "./repositories/web-admin.ts";

after(() => db.destroy());

function fakeProvider() {
  const live = new Set<string>();
  let failRevoke = false;
  const provider: ApiKeyProvider = {
    async create() {
      const keyId = `key_${randomUUID().replaceAll("-", "")}`;
      live.add(keyId);
      return { keyId, key: `scout_${randomBytes(16).toString("base64url")}` };
    },
    async revoke(keyId) {
      if (failRevoke) throw Error("provider down");
      live.delete(keyId);
    },
    async verify() {
      throw Error("unused");
    },
  };
  return { provider, live, setFailRevoke: (value: boolean) => (failRevoke = value) };
}

test("team-owned keys stay inside their organization and outlive their creator", async () => {
  const orgs = [randomUUID(), randomUUID()];
  const subjects = [1, 2, 3].map(() => `user_${randomUUID().replaceAll("-", "")}`);
  const fake = fakeProvider();
  const config: ApiKeyConfig = {
    provider: fake.provider,
    cipher: secretCipher(randomBytes(32).toString("base64")),
    ratePerMinute: 60,
  };
  const admin = async (org: string, subject: string) => {
    const member = await enrollMember({
      organizationId: org,
      organizationName: "API key fixture",
      frcTeamNumber: 1241,
      memberName: "Admin",
      role: "admin",
      channel: "fixture",
      externalUserId: randomUUID(),
    });
    await approveWebAdmin({ organizationId: org, memberId: member, approverId: member });
    await linkWebAdmin(org, member, subject);
    return member;
  };
  const [org, other] = orgs as [string, string];
  const [creator, coAdmin, outsider] = subjects as [string, string, string];
  try {
    const creatorMember = await admin(org, creator);
    await admin(org, coAdmin);
    await admin(other, outsider);

    assert.deepEqual(await listApiKeys(org, creator, config), []);
    const key = await createApiKey(org, creator, "Website", config);
    assert.ok(key && typeof key === "object");
    assert.match(key.secret, /^scout_/);
    assert.equal(key.start, key.secret.slice(0, 10));
    const stored = await db
      .selectFrom("api_key")
      .selectAll()
      .where("id", "=", key.id)
      .executeTakeFirstOrThrow();
    assert.ok(!stored.secret_ciphertext?.includes(key.secret));

    // Any admin of the team can view and copy the key again.
    assert.deepEqual(await listApiKeys(org, coAdmin, config), [key]);
    // Other teams and non-admins see nothing and cannot change anything.
    assert.equal(await listApiKeys(org, outsider, config), null);
    assert.deepEqual(await listApiKeys(other, outsider, config), []);
    assert.equal(await createApiKey(org, outsider, "Sneaky", config), null);
    assert.equal(await revokeApiKey(org, outsider, key.id, config), null);
    assert.equal(await revokeApiKey(other, outsider, key.id, config), false);
    assert.equal(await activeApiKey(other, stored.provider_key_id), false);
    assert.equal(await activeApiKey(org, stored.provider_key_id), true);

    // The key survives its creator's demotion and removal.
    await db.updateTable("member").set({ role: "scout" }).where("id", "=", creatorMember).execute();
    assert.equal(await listApiKeys(org, creator, config), null);
    await db.deleteFrom("web_admin_access").where("member_id", "=", creatorMember).execute();
    await db.deleteFrom("channel_identity").where("member_id", "=", creatorMember).execute();
    await db.deleteFrom("member").where("id", "=", creatorMember).execute();
    assert.deepEqual(
      (await listApiKeys(org, coAdmin, config))?.map((k) => k.id),
      [key.id],
    );

    // A failed provider revocation leaves the key listed so an admin can retry.
    fake.setFailRevoke(true);
    await assert.rejects(revokeApiKey(org, coAdmin, key.id, config));
    assert.equal((await listApiKeys(org, coAdmin, config))?.length, 1);
    fake.setFailRevoke(false);
    assert.equal(await revokeApiKey(org, coAdmin, key.id, config), true);
    assert.ok(!fake.live.has(stored.provider_key_id));
    assert.deepEqual(await listApiKeys(org, coAdmin, config), []);
    assert.equal(await activeApiKey(org, stored.provider_key_id), false);
    const revoked = await db
      .selectFrom("api_key")
      .selectAll()
      .where("id", "=", key.id)
      .executeTakeFirstOrThrow();
    assert.equal(revoked.secret_ciphertext, null);
    assert.equal(await revokeApiKey(org, coAdmin, key.id, config), false);

    for (let i = 0; i < MAX_ACTIVE_KEYS; i++) await createApiKey(org, coAdmin, `Key ${i}`, config);
    assert.equal(await createApiKey(org, coAdmin, "One too many", config), "limit");

    // The restricted runtime role sees only the tenant in its transaction context.
    const role = `api_key_test_${randomUUID().replaceAll("-", "")}`;
    await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(db);
    try {
      await sql`GRANT SELECT ON api_key TO ${sql.id(role)}`.execute(db);
      await db.transaction().execute(async (tx) => {
        await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
        assert.equal((await tx.selectFrom("api_key").select("id").execute()).length, 0);
        await sql`select set_config('app.organization_id', ${other}, true)`.execute(tx);
        assert.equal((await tx.selectFrom("api_key").select("id").execute()).length, 0);
      });
    } finally {
      await sql`drop owned by ${sql.id(role)}`.execute(db);
      await sql`drop role ${sql.id(role)}`.execute(db);
    }
  } finally {
    for (const id of orgs) {
      await db.deleteFrom("api_key").where("organization_id", "=", id).execute();
      await db.deleteFrom("web_admin_access").where("organization_id", "=", id).execute();
      await db.deleteFrom("channel_identity").where("organization_id", "=", id).execute();
      await db.deleteFrom("member").where("organization_id", "=", id).execute();
      await db.deleteFrom("organization").where("id", "=", id).execute();
    }
  }
});
