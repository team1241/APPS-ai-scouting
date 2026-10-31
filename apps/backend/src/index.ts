import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { startExtractionWorker } from "./extraction-worker.ts";
import { checkDatabase } from "./repositories/database.ts";
import { telegramRoutes } from "./telegram.ts";

const app = new Hono();
if (process.env.TELEGRAM_ORGANIZATION_ID && process.env.TELEGRAM_WEBHOOK_SECRET) {
  app.route(
    "/telegram/webhook",
    telegramRoutes(process.env.TELEGRAM_ORGANIZATION_ID, process.env.TELEGRAM_WEBHOOK_SECRET),
  );
}

// No database query, so a wake-up ping does not wake Neon.
app.get("/health", (c) => c.json({ ok: true }));

app.get("/health/db", async (c) => {
  await checkDatabase();
  return c.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`backend listening on ${port}`);
});

if (process.env.EXTRACTION_ENABLED === "true") {
  if (
    !process.env.TELEGRAM_ORGANIZATION_ID ||
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.MASTRA_URL
  ) {
    throw Error("Extraction requires Telegram organization, bot token, and MASTRA_URL");
  }
  const url = new URL(process.env.MASTRA_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw Error("Extraction currently supports a local Mastra server only");
  startExtractionWorker(
    process.env.TELEGRAM_ORGANIZATION_ID,
    process.env.MASTRA_URL,
    process.env.TELEGRAM_BOT_TOKEN,
  );
}
