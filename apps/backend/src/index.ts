import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { accessApplicationRoutes } from "./access-applications.ts";
import { createWorkerControl, eventMode } from "./event-mode.ts";
import { extractionConfig } from "./extraction-config.ts";
import { startExtractionWorker } from "./extraction-worker.ts";
import { startOutboundWorker } from "./outbound-worker.ts";
import { saveAccessApplication } from "./repositories/access-applications.ts";
import { checkDatabase, closeDatabase } from "./repositories/database.ts";
import { workerEvents } from "./repositories/operations.ts";
import { adminOrganizations } from "./repositories/web-admin.ts";
import { telegramRoutes } from "./telegram.ts";
import { webAdminRoutes } from "./web-admin.ts";
import { webSessionVerifier } from "./web-auth.ts";

const extraction = extractionConfig(process.env);
const app = new Hono();
app.route("/web/access-applications", accessApplicationRoutes({ save: saveAccessApplication }));
app.route(
  "/web",
  webAdminRoutes({ verify: webSessionVerifier(process.env), organizations: adminOrganizations }),
);
const org = process.env.TELEGRAM_ORGANIZATION_ID;
const control = createWorkerControl(eventMode(process.env), () =>
  org ? workerEvents(org) : Promise.resolve([]),
);
// Load before accepting traffic; startup failure cannot leave an apparently healthy auto worker.
await control.refresh();
app.use("/telegram/webhook", async (c, next) => {
  await next();
  if (c.res.status === 200) {
    control.wake();
    // Committed event changes become visible without polling the database while idle.
    void control.refresh().catch(() => console.error("Event-window refresh failed"));
  }
});
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
    workers: { mode: control.mode, active: control.active() },
    ...(process.env.RAILWAY_GIT_COMMIT_SHA ? { revision: process.env.RAILWAY_GIT_COMMIT_SHA } : {}),
  }),
);

app.get("/health/db", async (c) => {
  await checkDatabase();
  return c.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`backend listening on ${info.port}`);
});

const stops: (() => Promise<void>)[] = [];
if (extraction) {
  stops.push(
    startExtractionWorker(
      extraction.organizationId,
      extraction.baseUrl,
      extraction.botToken,
      extraction.serviceToken,
      control.active,
    ),
  );
}

if (process.env.TELEGRAM_ORGANIZATION_ID && process.env.TELEGRAM_BOT_TOKEN)
  stops.push(
    startOutboundWorker(
      process.env.TELEGRAM_ORGANIZATION_ID,
      process.env.TELEGRAM_BOT_TOKEN,
      control.active,
    ),
  );
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  control.stop();
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    ...stops.map((stop) => stop()),
  ]);
  await closeDatabase();
  clearTimeout(deadline);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
