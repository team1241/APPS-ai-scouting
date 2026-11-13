import { timingSafeEqual } from "node:crypto";
import type { ObservationKind } from "@ai-scouting/scouting";
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

const notEnrolled = "To get started, open the invitation or connection link from your team admin.";

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
        return answer("Choose your team in a private chat with me.");
      const selected =
        typeof callback.data === "string"
          ? /^team:([0-9a-f-]{36})$/i.exec(callback.data)?.[1]
          : undefined;
      if (!selected || !uuidPattern.test(selected))
        return answer("Send /team to see your teams again.");
      try {
        const user = String(sender?.id);
        const team = (await senderTeams(user)).find((t) => t.id === selected);
        if (!team)
          return answer("You no longer have access to this team. Send /team to see your teams.");
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
          return reply("This link doesn't work anymore. Ask your team admin for a new one.");
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
              ? `Telegram is connected to your admin account for Team ${team.frc_team_number}.\n\nNext steps:\n1. Send /team to choose your team.\n2. Send /invite to create a link for your scouts.`
              : "This connection link has expired, was already used, or belongs to another account. Disconnect Telegram on your team page, then try again.",
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
          if (!teams.length) return reply(notEnrolled);
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
              ? "You're on more than one team. Choose a team with /team, then send your message again."
              : notEnrolled,
          );
      }
      const boundOrganization = await bindMessageTeam(
        user,
        String(update.update_id),
        organizationId,
      );
      if (!boundOrganization) return reply("Something went wrong. Please send your message again.");
      organizationId = boundOrganization;
      // Scouts choose the kind explicitly: a plain note is match scouting, /pit and /general
      // start pit and general notes. Intake never asks the model to choose a contract.
      const kindCommand = /^\/(match|pit|general)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(
        message.text.trim(),
      );
      if (kindCommand && !kindCommand[2]?.trim())
        return reply(
          kindCommand[1]?.toLowerCase() === "general"
            ? "Add your note after /general, for example:\n/general The field lights flickered in Q12"
            : kindCommand[1]?.toLowerCase() === "pit"
              ? "Add your note after /pit, for example:\n/pit 1241 swerve drive, can climb"
              : "Add your note after /match, for example:\n/match Q12 1241 climbed high\n\nYou can also send the note without a command.",
        );
      const override = /^\/scout(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(message.text.trim());
      const explicit = override
        ? /^(\S+)(?:\s+(match|pit|general)(?=\s))?\s+([\s\S]+)$/i.exec(override[1] ?? "")
        : null;
      if (override && (!explicit || !uuidPattern.test(explicit[1] ?? "") || !explicit[3]?.trim()))
        return c.json({
          method: "sendMessage",
          chat_id: chat.id,
          text: "To send a note for a different event, use:\n/scout <event-id> [pit|general] <note>\n\nSend /events to find event IDs.",
        });
      const kind = (kindCommand?.[1] ?? explicit?.[2])?.toLowerCase() as
        | ObservationKind
        | undefined;
      const newNote = Boolean(override || kindCommand);
      const commandReply = newNote
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
        kind,
        replyDeliveryId:
          typeof object(message.reply_to_message)?.text === "string"
            ? /Session reference: ([0-9a-f-]{36})$/.exec(
                String(object(message.reply_to_message)?.text),
              )?.[1]
            : undefined,
        replyToMessageId:
          !newNote && Number.isSafeInteger(object(message.reply_to_message)?.message_id)
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
            ? "You're not on a team yet. Ask your team admin for an invitation link."
            : result === "no_active_event"
              ? "Your note wasn't saved because no event is active yet.\nAsk a team admin to set one with /event set <season> <FRC code>, then send your note again."
              : result === "invalid_event"
                ? "Your note wasn't saved because that event isn't available.\nSend /events to find a valid event ID, then send your note again."
                : result === "completed_session"
                  ? "That note is already saved, so it can't take more replies.\nIf something in it is wrong, use /flag <team-number> [match-number] [note]."
                  : result === "legacy_session"
                    ? "Your reply wasn't saved because that note is from before events were tracked.\nPlease send the full note again as a new message."
                    : result === "kind_unassigned"
                      ? `Your note wasn't saved because ${kind} scouting isn't set up for this event yet.\nAsk a team admin to choose a ${kind} specification for the event in the web app, then send your note again.`
                      : `Got it! Reading your ${result.kind === "match" ? "" : `${result.kind} `}note for ${result.eventName}…`,
      });
    } catch {
      console.error("Telegram intake database transaction failed");
      return c.json({ error: "Storage unavailable; retry delivery" }, 503);
    }
  });
  return app;
}
