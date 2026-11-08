import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { extractionConfig } from "./extraction-config.ts";
import { startExtractionWorker } from "./extraction-worker.ts";
import { startOutboundWorker } from "./outbound-worker.ts";
import { checkDatabase } from "./repositories/database.ts";
import { adminOrganizations } from "./repositories/web-admin.ts";
import { telegramRoutes } from "./telegram.ts";
import { webAdminRoutes } from "./web-admin.ts";
import { webSessionVerifier } from "./web-auth.ts";

const extraction = extractionConfig(process.env);
const app = new Hono();
app.route(
  "/web",
  webAdminRoutes({ verify: webSessionVerifier(process.env), organizations: adminOrganizations }),
);
if (process.env.TELEGRAM_ORGANIZATION_ID && process.env.TELEGRAM_WEBHOOK_SECRET) {
  app.route(
    "/telegram/webhook",
    telegramRoutes(process.env.TELEGRAM_ORGANIZATION_ID, process.env.TELEGRAM_WEBHOOK_SECRET),
  );
}

// No database query, so a wake-up ping does not wake Neon.
app.get("/health", (c) =>
  c.json({
    ok: true,
    ...(process.env.RAILWAY_GIT_COMMIT_SHA ? { revision: process.env.RAILWAY_GIT_COMMIT_SHA } : {}),
  }),
);

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

if (process.env.TELEGRAM_ORGANIZATION_ID && process.env.TELEGRAM_BOT_TOKEN)
  startOutboundWorker(process.env.TELEGRAM_ORGANIZATION_ID, process.env.TELEGRAM_BOT_TOKEN);
