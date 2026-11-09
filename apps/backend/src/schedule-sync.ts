import { db } from "./db.ts";
import { eventMode } from "./event-mode.ts";
import { organizationIds } from "./repositories/telegram-connect.ts";
import { runScheduleJob } from "./schedule-job.ts";

try {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !process.env.DATABASE_URL)
    throw new Error("Schedule job requires database and bot configuration");
  for (const organizationId of await organizationIds()) {
    try {
      console.log(
        await runScheduleJob(organizationId, botToken, {
          deliver: eventMode(process.env) !== "off",
        }),
      );
    } catch {
      console.error("Organization schedule sync failed");
      process.exitCode = 1;
    }
  }
} catch {
  console.error("Schedule job failed; inspect persisted schedule status");
  process.exitCode = 1;
} finally {
  await db.destroy();
}
