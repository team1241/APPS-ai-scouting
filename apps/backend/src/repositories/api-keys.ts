import { sql } from "kysely";
import type { ApiKeyConfig } from "../api-keys.ts";
import { withTenant } from "./tenant.ts";
import { webAdminMember } from "./web-admin.ts";

export const MAX_ACTIVE_KEYS = 10;

export interface ApiKeySummary {
  id: string;
  name: string;
  start: string;
  secret: string;
  rateLimitPerMinute: number;
  createdAt: string;
}

const columns = [
  "id",
  "name",
  "start",
  "secret_ciphertext",
  "rate_limit_per_minute",
  "created_at",
] as const;

function summary(
  row: {
    id: string;
    name: string;
    start: string;
    secret_ciphertext: string | null;
    rate_limit_per_minute: number;
    created_at: Date | string;
  },
  config: ApiKeyConfig,
): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    start: row.start,
    secret: config.cipher.decrypt(row.secret_ciphertext ?? ""),
    rateLimitPerMinute: row.rate_limit_per_minute,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// Null when the subject is not a linked admin of the organization.
export function listApiKeys(org: string, subject: string, config: ApiKeyConfig) {
  return withTenant(org, async (tx) => {
    if (!(await webAdminMember(tx, org, subject))) return null;
    const rows = await tx
      .selectFrom("api_key")
      .select(columns)
      .where("organization_id", "=", org)
      .where("revoked_at", "is", null)
      .orderBy("created_at", "desc")
      .execute();
    return rows.map((row) => summary(row, config));
  });
}

export function createApiKey(org: string, subject: string, name: string, config: ApiKeyConfig) {
  return withTenant(org, async (tx): Promise<ApiKeySummary | "limit" | null> => {
    const admin = await webAdminMember(tx, org, subject);
    if (!admin) return null;
    // Serializes creation per team so the active-key limit holds.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${org}:api-keys`}, 0))`.execute(tx);
    const { count } = await tx
      .selectFrom("api_key")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("organization_id", "=", org)
      .where("revoked_at", "is", null)
      .executeTakeFirstOrThrow();
    if (Number(count) >= MAX_ACTIVE_KEYS) return "limit";
    const issued = await config.provider.create({
      organizationId: org,
      ratePerMinute: config.ratePerMinute,
    });
    try {
      const row = await tx
        .insertInto("api_key")
        .values({
          organization_id: org,
          name,
          provider_key_id: issued.keyId,
          start: issued.key.slice(0, 10),
          secret_ciphertext: config.cipher.encrypt(issued.key),
          rate_limit_per_minute: config.ratePerMinute,
          created_by: admin.id,
        })
        .returning(columns)
        .executeTakeFirstOrThrow();
      return summary(row, config);
    } catch (error) {
      // Do not leave a working key that no admin can see or revoke.
      await config.provider.revoke(issued.keyId).catch(() => {
        console.error("Orphaned API key cleanup failed");
      });
      throw error;
    }
  });
}

export function revokeApiKey(org: string, subject: string, id: string, config: ApiKeyConfig) {
  return withTenant(org, async (tx): Promise<boolean | null> => {
    const admin = await webAdminMember(tx, org, subject);
    if (!admin) return null;
    const key = await tx
      .selectFrom("api_key")
      .select("provider_key_id")
      .where("organization_id", "=", org)
      .where("id", "=", id)
      .where("revoked_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!key) return false;
    // Provider first: if it fails, the key stays listed so an admin can retry.
    await config.provider.revoke(key.provider_key_id);
    await tx
      .updateTable("api_key")
      .set({ revoked_at: sql`now()`, revoked_by: admin.id, secret_ciphertext: null })
      .where("organization_id", "=", org)
      .where("id", "=", id)
      .execute();
    return true;
  });
}

// Second check after provider verification: the key must still be active in its own team.
export function activeApiKey(org: string, providerKeyId: string) {
  return withTenant(org, async (tx) => {
    const key = await tx
      .selectFrom("api_key")
      .select("id")
      .where("organization_id", "=", org)
      .where("provider_key_id", "=", providerKeyId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return key !== undefined;
  });
}
