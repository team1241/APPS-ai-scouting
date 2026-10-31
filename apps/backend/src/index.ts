import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { extractionConfig } from "./extraction-config.ts";
import { startExtractionWorker } from "./extraction-worker.ts";
import { checkDatabase } from "./repositories/database.ts";
import { telegramRoutes } from "./telegram.ts";

const extraction = extractionConfig(process.env);
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

if (extraction) {
  startExtractionWorker(
    extraction.organizationId,
    extraction.baseUrl,
    extraction.botToken,
    extraction.serviceToken,
  );
}
