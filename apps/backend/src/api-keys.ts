import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Unkey issues, rate-limits and verifies keys. Unkey stores only a hash, so we keep
// an encrypted copy that team admins can view again at any time.
export interface ApiKeyProvider {
  create(input: {
    organizationId: string;
    ratePerMinute: number;
  }): Promise<{ keyId: string; key: string }>;
  // Resolves when the key is gone, including when it was already deleted.
  revoke(keyId: string): Promise<void>;
  verify(key: string): Promise<ApiKeyVerification>;
}

export type ApiKeyVerification =
  | { valid: true; keyId: string; organizationId: string }
  | { valid: false; code: "invalid" | "rate_limited" };

export class ProviderUnavailable extends Error {}

export interface ApiKeyConfig {
  provider: ApiKeyProvider;
  cipher: SecretCipher;
  ratePerMinute: number;
}

export function apiKeyConfig(
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
): ApiKeyConfig | null {
  const rootKey = env.UNKEY_ROOT_KEY;
  const apiId = env.UNKEY_API_ID;
  const encryptionKey = env.API_KEY_ENCRYPTION_KEY;
  if (!rootKey || !apiId || !encryptionKey) return null;
  const ratePerMinute = Number(env.API_KEY_RATE_LIMIT_PER_MINUTE ?? 60);
  if (!Number.isInteger(ratePerMinute) || ratePerMinute < 1)
    throw Error("API_KEY_RATE_LIMIT_PER_MINUTE must be a positive integer");
  return {
    provider: unkeyProvider(rootKey, apiId, fetcher),
    cipher: secretCipher(encryptionKey),
    ratePerMinute,
  };
}

export interface SecretCipher {
  encrypt(secret: string): string;
  decrypt(ciphertext: string): string;
}

export function secretCipher(base64Key: string): SecretCipher {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw Error("API_KEY_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return {
    encrypt(secret) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      return ["v1", iv, cipher.getAuthTag(), body]
        .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
        .join(":");
    },
    decrypt(ciphertext) {
      const [version, iv, tag, body] = ciphertext.split(":");
      if (version !== "v1" || !iv || !tag || !body) throw Error("Unsupported key ciphertext");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

const RATE_LIMIT = "requests";

export function unkeyProvider(
  rootKey: string,
  apiId: string,
  fetcher: typeof fetch = fetch,
): ApiKeyProvider {
  async function call<T>(procedure: string, body: unknown): Promise<{ status: number; data?: T }> {
    let response: Response;
    try {
      response = await fetcher(`https://api.unkey.com/v2/${procedure}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${rootKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ProviderUnavailable(`Unkey ${procedure} unreachable`);
    }
    // Error bodies hold only provider codes; never log request bodies, which contain keys.
    if (!response.ok) return { status: response.status };
    const json = (await response.json()) as { data?: T };
    return { status: response.status, data: json.data };
  }
  return {
    async create({ organizationId, ratePerMinute }) {
      const result = await call<{ keyId: string; key: string }>("keys.createKey", {
        apiId,
        prefix: "scout",
        // Names stay in our database: an admin may type a person's name.
        // The organization UUID only. No personal or scouting data goes to the provider.
        externalId: organizationId,
        ratelimits: [{ name: RATE_LIMIT, limit: ratePerMinute, duration: 60_000, autoApply: true }],
      });
      if (!result.data?.keyId || !result.data.key)
        throw new ProviderUnavailable(`Unkey keys.createKey failed with ${result.status}`);
      return result.data;
    },
    async revoke(keyId) {
      const result = await call("keys.deleteKey", { keyId });
      if (result.status !== 200 && result.status !== 404)
        throw new ProviderUnavailable(`Unkey keys.deleteKey failed with ${result.status}`);
    },
    async verify(key) {
      const result = await call<{
        valid: boolean;
        code: string;
        keyId?: string;
        identity?: { externalId?: string };
      }>("keys.verifyKey", { key });
      // Quota exhaustion, outages and bad configuration all fail closed.
      if (!result.data)
        throw new ProviderUnavailable(`Unkey keys.verifyKey failed with ${result.status}`);
      const { valid, code, keyId, identity } = result.data;
      if (valid && keyId && identity?.externalId)
        return { valid: true, keyId, organizationId: identity.externalId };
      return { valid: false, code: code === "RATE_LIMITED" ? "rate_limited" : "invalid" };
    },
  };
}
