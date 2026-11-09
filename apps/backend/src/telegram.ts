import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { uuidPattern } from "./event-config.ts";
import { saveIncomingNote } from "./repositories/intake.ts";
import {
  activeTeam,
  bindMessageTeam,
  consumeConnect,
  senderTeams,
  tokenOrganization,
} from "./repositories/telegram-connect.ts";
import { withTenant } from "./repositories/tenant.ts";
import { telegramCommand } from "./telegram-commands.ts";

export function telegramRoutes(secret: string) {
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
    const callback = object(update.callback_query);
    if (callback) {
      const sender = object(callback.from);
      const chat = object(object(callback.message)?.chat);
      if (typeof callback.id !== "string" || !Number.isSafeInteger(sender?.id))
        return c.json({ error: "Invalid callback" }, 400);
      const answer = (text: string) =>
        c.json({ method: "answerCallbackQuery", callback_query_id: callback.id, text });
      if (chat?.type !== "private" || chat.id !== sender?.id)
        return answer("Select your team in a private chat with the bot.");
      const selected =
        typeof callback.data === "string"
          ? /^team:([0-9a-f-]{36})$/i.exec(callback.data)?.[1]
          : undefined;
      if (!selected || !uuidPattern.test(selected))
        return answer("Use /team to open the team list again.");
      try {
        const user = String(sender?.id);
        const team = (await senderTeams(user)).find((t) => t.id === selected);
        if (!team)
          return answer("You no longer have access to this team. Use /team to refresh the list.");
        await activeTeam(user, team.id);
        return answer(`Active team: ${team.teamNumber} · ${team.name}`.slice(0, 200));
      } catch {
        console.error("Telegram team selection failed");
        return c.json({ error: "Storage unavailable; retry delivery" }, 503);
      }
    }
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
      const user = String(sender?.id);
      const reply = (text: string) => c.json({ method: "sendMessage", chat_id: chat.id, text });
      const start = /^\/start(?:@\w+)?\s+(connect|join)_([A-Za-z0-9_-]{32})$/.exec(
        message.text.trim(),
      );
      let organizationId: string | null = null;
      if (start?.[2]) {
        organizationId = await tokenOrganization(start[2], start[1] === "connect");
        if (!organizationId)
          return reply("This link is invalid. Ask your team admin for a new link.");
        if (start[1] === "connect") {
          const connectedOrganizationId = organizationId;
          const team = await withTenant(connectedOrganizationId, (tx) =>
            tx
              .selectFrom("organization")
              .select("frc_team_number")
              .where("id", "=", connectedOrganizationId)
              .executeTakeFirstOrThrow(),
          );
          const connected = await consumeConnect(organizationId, start[2], user);
          return reply(
            connected
              ? `Telegram connected to your administrator account for Team ${team.frc_team_number}. Use /team to choose your team, then /invite to invite scouts.`
              : "This connection link expired, was used, or conflicts with an existing account. Disconnect on the team page before reconnecting.",
          );
        }
      } else {
        const teams = await senderTeams(user);
        const selection = /^\/team(?:@\w+)?(?:\s+(\S+))?$/.exec(message.text.trim());
        if (selection) {
          const chosen = teams.find((t) => t.id === selection[1]);
          if (chosen) {
            await activeTeam(user, chosen.id);
            return reply(`Active team: ${chosen.teamNumber} · ${chosen.name}`);
          }
          if (!teams.length) return reply("Open your team's invitation or connection link first.");
          return c.json({
            method: "sendMessage",
            chat_id: chat.id,
            text: "Choose a team:",
            reply_markup: {
              inline_keyboard: teams.map((team) => [
                {
                  text: `${team.teamNumber} · ${team.name}`.slice(0, 100),
                  callback_data: `team:${team.id}`,
                },
              ]),
            },
          });
        }
        const active = await activeTeam(user);
        organizationId =
          teams.length === 1
            ? (teams[0]?.id ?? null)
            : (teams.find((t) => t.id === active)?.id ?? null);
        if (!organizationId)
          return reply(
            teams.length
              ? "Choose a team with /team before sending a message."
              : "Open your team's invitation or connection link first.",
          );
      }
      const boundOrganization = await bindMessageTeam(
        user,
        String(update.update_id),
        organizationId,
      );
      if (!boundOrganization)
        return reply("This update could not be routed. Send your message again.");
      organizationId = boundOrganization;
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
        replyDeliveryId:
          typeof object(message.reply_to_message)?.text === "string"
            ? /Session reference: ([0-9a-f-]{36})$/.exec(
                String(object(message.reply_to_message)?.text),
              )?.[1]
            : undefined,
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
                  ? "That completed submission cannot accept this reply. Use /flag <team-number> [match-number] [note] to request an investigation."
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
