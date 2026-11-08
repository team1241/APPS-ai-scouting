import { db } from "./db.ts";
import { eventMode } from "./event-mode.ts";
import { runScheduleJob } from "./schedule-job.ts";

try {
  const organizationId = process.env.TELEGRAM_ORGANIZATION_ID,
    botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!organizationId || !botToken || !process.env.DATABASE_URL)
    throw new Error("Schedule job requires database, organization and bot configuration");
  console.log(
    await runScheduleJob(organizationId, botToken, { deliver: eventMode(process.env) !== "off" }),
  );
} catch {
  console.error("Schedule job failed; inspect persisted schedule status");
  process.exitCode = 1;
} finally {
  await db.destroy();
}
