import { eventMode } from "./event-mode.ts";
import { extractionConfig } from "./extraction-config.ts";
import { runExtractionPass } from "./extraction-worker.ts";
import { drainOutbound } from "./outbound-worker.ts";
import { closeDatabase } from "./repositories/database.ts";
import { organizationIds } from "./repositories/telegram-connect.ts";

// Separate Railway cron service: bounded recovery, not a sleeping HTTP process timer.
try {
  if (eventMode(process.env) !== "off") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !process.env.DATABASE_URL)
      throw Error("Recovery requires database and bot configuration");
    const extraction = extractionConfig(process.env);
    for (const org of await organizationIds()) {
      try {
        let attempted = 0;
        if (extraction)
          for (let i = 0; i < 3; i++) {
            if (!(await runExtractionPass(org, extraction.baseUrl, extraction.serviceToken))) break;
            attempted++;
          }
        console.log(
          JSON.stringify({
            event: "recovery_pass",
            extractionAttempts: attempted,
            delivered: await drainOutbound(org, token, fetch, undefined, () => true, 10),
          }),
        );
      } catch {
        console.error("Organization recovery failed");
        process.exitCode = 1;
      }
    }
  }
} catch {
  console.error("Recovery pass failed; inspect durable queue state");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
