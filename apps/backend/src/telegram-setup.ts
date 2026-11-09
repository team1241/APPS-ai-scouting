import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { closeDatabase } from "./repositories/database.ts";
import { enrollMember } from "./repositories/members.ts";

const [command, value] = process.argv.slice(2);
function saveEnv(values: Record<string, string>) {
  const lines = readFileSync(".env", "utf8")
    .split("\n")
    .filter((line) => !Object.keys(values).some((key) => line.startsWith(`${key}=`)));
  writeFileSync(
    ".env",
    lines.filter(Boolean).join("\n") +
      "\n" +
      Object.entries(values)
        .map(([key, val]) => `${key}=${JSON.stringify(val)}`)
        .join("\n") +
      "\n",
  );
  chmodSync(".env", 0o600);
}
try {
  if (command === "enroll" && value && /^\d+$/.test(value)) {
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.ALLOW_LOCAL_TELEGRAM_ENROLL !== "true"
    )
      throw Error(
        "Local enrollment requires NODE_ENV=development and ALLOW_LOCAL_TELEGRAM_ENROLL=true",
      );
    const id = process.env.TELEGRAM_ORGANIZATION_ID || randomUUID();
    await enrollMember({
      organizationId: id,
      organizationName: "Team 1241",
      frcTeamNumber: 1241,
      memberName: "Julian",
      role: "admin",
      channel: "telegram",
      externalUserId: value,
    });
    saveEnv({
      TELEGRAM_ORGANIZATION_ID: id,
      TELEGRAM_WEBHOOK_SECRET:
        process.env.TELEGRAM_WEBHOOK_SECRET || randomBytes(32).toString("hex"),
    });
    console.log("Enrolled Telegram account for local Team 1241 testing.");
  } else if (command === "webhook" && value) {
    const url = new URL(value);
    if (url.protocol !== "https:") throw Error("Webhook requires HTTPS");
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET)
      throw Error("Configure TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET");
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: new URL("/telegram/webhook", url).toString(),
          secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ["message", "callback_query"],
        }),
      },
    );
    const result = (await response.json()) as { ok: boolean };
    if (!result.ok) throw Error("Telegram rejected webhook registration");
    console.log("Telegram webhook registered.");
  } else
    throw Error("Usage: telegram-setup.ts enroll <numeric-user-id> | webhook <https-base-url>");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Telegram setup failed");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
