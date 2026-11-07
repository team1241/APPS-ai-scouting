import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { uuidPattern } from "./event-config.ts";
import { saveIncomingNote } from "./repositories/intake.ts";
import { telegramCommand } from "./telegram-commands.ts";

export function telegramRoutes(organizationId: string, secret: string) {
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));
  app.post("/", async (c) => {
    const supplied = Buffer.from(c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "");
    const expected = Buffer.from(secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const object = (value: unknown): Record<string, unknown> | undefined =>
      value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
    let update: Record<string, unknown> | undefined;
    try {
      update = object(await c.req.json());
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!update || !Number.isSafeInteger(update.update_id))
      return c.json({ error: "Invalid update" }, 400);
    const message = object(update.message);
    const chat = object(message?.chat);
    const sender = object(message?.from);
    if (!message || chat?.type !== "private" || typeof message.text !== "string") {
      return c.json({ ok: true });
    }
    if (!Number.isSafeInteger(sender?.id) || !Number.isSafeInteger(chat?.id)) {
      return c.json({ error: "Invalid message" }, 400);
    }
    try {
      const override = /^\/scout(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(message.text.trim());
      const explicit = override ? /^(\S+)\s+([\s\S]+)$/.exec(override[1] ?? "") : null;
      if (override && (!explicit || !uuidPattern.test(explicit[1] ?? "") || !explicit[2]?.trim()))
        return c.json({
          method: "sendMessage",
          chat_id: chat.id,
          text: "Use /scout <event-id> <note>. Find event IDs with /events.",
        });
      const commandReply = override
        ? null
        : await telegramCommand({
            organizationId,
            userId: String(sender?.id),
            updateId: String(update.update_id),
            text: message.text,
            name: typeof sender?.first_name === "string" ? sender.first_name : "Scout",
            botToken: process.env.TELEGRAM_BOT_TOKEN,
          });
      if (commandReply !== null)
        return c.json({
          method: "sendMessage",
          chat_id: chat?.id,
          text: commandReply,
          link_preview_options: { is_disabled: true },
        });
      const result = await saveIncomingNote({
        organizationId,
        channel: "telegram",
        externalUserId: String(sender?.id),
        externalUpdateId: String(update.update_id),
        text: message.text,
        eventId: explicit?.[1],
        replyToMessageId:
          !override && Number.isSafeInteger(object(message.reply_to_message)?.message_id)
            ? String(object(message.reply_to_message)?.message_id)
            : undefined,
      });
      // Telegram executes this reply after the transaction commits. Reply failure cannot lose intake.
      if (result === "duplicate") return c.json({ ok: true });
      return c.json({
        method: "sendMessage",
        chat_id: chat?.id,
        text:
          result === "unknown"
            ? "Your account is not enrolled. Contact your team administrator."
            : result === "no_active_event"
              ? "Your note was not submitted because no event is active. Ask a team admin to select one with /event set <season> <FRC code>, then resend your note."
              : result === "invalid_event"
                ? "Your note was not submitted because the selected event is unavailable. Check /events and resend it with a valid event."
                : result === "completed_session"
                  ? "That session is complete. Corrections are not supported yet (#4); this reply was not added or submitted as a new note."
                  : result === "legacy_session"
                    ? "This older session has no event. Your reply was not submitted. Check /event, then resend the complete note as a new message."
                    : `Received your scouting note. Processing it now…\nEvent: ${result.eventName}`,
      });
    } catch {
      console.error("Telegram intake database transaction failed");
      return c.json({ error: "Storage unavailable; retry delivery" }, 503);
    }
  });
  return app;
}
