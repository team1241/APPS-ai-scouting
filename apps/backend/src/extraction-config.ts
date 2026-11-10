export interface MastraConfig {
  baseUrl: string;
  serviceToken?: string;
}

export interface ExtractionConfig extends MastraConfig {
  botToken: string;
}

// The Mastra server address and credential. Null when MASTRA_URL is not set.
export function mastraConfig(env: NodeJS.ProcessEnv): MastraConfig | null {
  if (!env.MASTRA_URL?.trim()) return null;
  const url = new URL(env.MASTRA_URL);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw Error("MASTRA_URL must be a base URL without credentials, path, query or fragment");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!["http:", "https:"].includes(url.protocol) || (!local && url.protocol !== "https:"))
    throw Error("Hosted Mastra requires HTTPS");
  if ((!local || env.NODE_ENV === "production") && !env.MASTRA_SERVICE_TOKEN?.trim())
    throw Error("Hosted extraction requires MASTRA_SERVICE_TOKEN");
  return { baseUrl: url.toString(), serviceToken: env.MASTRA_SERVICE_TOKEN };
}

export function extractionConfig(env: NodeJS.ProcessEnv): ExtractionConfig | null {
  if (env.EXTRACTION_ENABLED !== undefined && !["true", "false"].includes(env.EXTRACTION_ENABLED)) {
    throw Error("EXTRACTION_ENABLED must be true or false");
  }
  if (env.EXTRACTION_ENABLED !== "true") return null;
  for (const name of [
    "DATABASE_URL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "MASTRA_URL",
  ]) {
    if (!env[name]?.trim()) throw Error(`Extraction requires ${name}`);
  }
  return { ...(mastraConfig(env) as MastraConfig), botToken: env.TELEGRAM_BOT_TOKEN as string };
}
