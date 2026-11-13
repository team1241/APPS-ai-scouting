import { eventCommand } from "./event-commands.ts";
import { uuidPattern } from "./event-config.ts";
import { outcomeLabel } from "./extraction-reply.ts";
import { flagUsage } from "./flag-command.ts";
import { readObservationFlags, submitObservationFlag } from "./repositories/flags.ts";
import {
  createInvitation,
  joinInvitation,
  listInvitations,
  revokeInvitation,
} from "./repositories/invitations.ts";
import { memberRole } from "./repositories/membership.ts";

const invalidInvitation =
  "This invitation link doesn't work anymore. Ask your team admin for a new one.";
const adminsOnly = "Only team admins can manage invitations.";

function timestamp(value: Date) {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function answers(values: unknown) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "none";
  const lines = Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(
      ([key, value]) => `• ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
    );
  return lines.length ? `\n${lines.join("\n")}`.slice(0, 900) : "none";
}

export async function telegramCommand(input: {
  organizationId: string;
  userId: string;
  updateId: string;
  text: string;
  name: string;
  botToken?: string;
}): Promise<string | null> {
  if (!input.text.startsWith("/")) return null;
  const eventReply = await eventCommand(input);
  if (eventReply !== null) return eventReply;
  const [rawCommand, ...rest] = input.text.trim().split(/\s+/);
  const command = rawCommand?.split("@")[0]?.toLowerCase();
  const argument = rest.join(" ");
  const { organizationId, userId } = input;
  if (command === "/correct" || command === "/reextract")
    return "To report a mistake, use /flag <team-number> [match-number] [note]. You don't need to send your note again.";
  if (command === "/flag") {
    const result = await submitObservationFlag({
      ...input,
      argument: input.text.replace(/^\/flag(?:@\w+)?\s*/i, ""),
      commandText: input.text,
    });
    if (result.status === "forbidden") return "Join your team before flagging notes.";
    if (result.status === "invalid") return flagUsage;
    if (result.status === "missing")
      return "I couldn't find a saved note of yours for that team and match. Check the numbers and try again.\n\nLeave out the match to flag your most recent note for that team.";
    if (result.status === "ambiguous")
      return "More than one of your notes matches that team and match, so nothing was flagged.\n\nLeave out the match to flag your most recent note for that team, or ask an admin to look into it.";
    const target = (await readObservationFlags(organizationId, userId, result.flag.id))?.[0];
    return `Flag ${result.duplicate ? "already recorded" : "recorded"} for Team ${result.flag.team_number}${target ? ` · ${target.match_label ?? "unknown match"} · ${target.event_name.slice(0, 100)}` : ""}.\nYour original note is kept as it was.\n\nAnyone on your team can view this flag with:\n/flags ${result.flag.id}`;
  }
  if (command === "/flags") {
    if (argument && !uuidPattern.test(argument))
      return "Send /flags to see recent flags, or /flags <flag-id> to see one.";
    const flags = await readObservationFlags(organizationId, userId, argument || undefined);
    if (flags === null) return "Join your team to see flags.";
    if (!flags.length) return argument ? "I couldn't find that flag." : "No flags yet.";
    if (argument) {
      const flag = flags[0];
      if (!flag) return "I couldn't find that flag.";
      return `Flag for Team ${flag.team_number} · ${flag.match_label?.slice(0, 50) ?? "unknown match"}\nEvent: ${flag.event_name.slice(0, 100)}\nScout: ${flag.scout_name.slice(0, 100)}\nFlagged: ${timestamp(flag.created_at)}\nNote: ${flag.note ?? "none"}\n\nSaved note: ${outcomeLabel(flag.outcome)}${flag.revision_current ? "" : " (since replaced)"}\nAnswers: ${answers(flag.values)}\n\nFlag ID: ${flag.id}\nRevision: ${flag.revision_id}\nSpecification: ${flag.specification_version.slice(0, 100)}`;
    }
    // Keep Telegram replies below its message length limit. Details remain available by ID.
    return `Recent flags (up to 20):\n\n${flags.map((flag) => `Team ${flag.team_number} · ${flag.match_label?.slice(0, 20) ?? "unknown match"} · ${flag.event_name.slice(0, 30)} · ${flag.scout_name.slice(0, 25)}\n/flags ${flag.id}`).join("\n\n")}`;
  }
  if (command === "/start" && argument.startsWith("join_")) {
    const token = argument.slice(5);
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return invalidInvitation;
    const result = await joinInvitation(organizationId, userId, input.name, token);
    return result === "invalid"
      ? invalidInvitation
      : result === "already_joined"
        ? "You're already on the team. Send a scouting note whenever you're ready."
        : "Welcome aboard! You've joined as a scout.\n\nSend a note with the match and team number to get started, for example:\nQ12 1241 climbed high\n\nSend /help to see everything I can do.";
  }
  if (command === "/invite") {
    if ((await memberRole(organizationId, userId))?.role !== "admin") return adminsOnly;
    if (!input.botToken) throw Error("Bot token required for invitation links");
    const r = await fetch(`https://api.telegram.org/bot${input.botToken}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const me = (await r.json()) as { ok?: boolean; result?: { username?: string } };
    if (!r.ok || !me.ok || !me.result?.username) throw Error("Could not resolve bot username");
    const invite = await createInvitation(organizationId, userId, input.updateId, argument);
    if (invite.status === "forbidden") return adminsOnly;
    if (invite.status === "duplicate")
      return "I already handled that /invite. Send /invites to find its link, or /invite again for a new one.";
    return `Here's your scout invitation link:\nhttps://t.me/${me.result.username}?start=join_${invite.token}\n\nAnyone with this link can join as a scout until you revoke it.\n\nTo revoke it:\n/revokeinvite ${invite.id}`;
  }
  if (command === "/invites") {
    const invites = await listInvitations(organizationId, userId);
    if (!invites) return adminsOnly;
    return invites.length
      ? `Your invitation links:\n\n${invites
          .map(
            (i) =>
              `${i.label} · ${i.revoked_at ? "revoked" : "active"} · ${i.uses} joined${i.revoked_at ? "" : `\n/revokeinvite ${i.id}`}`,
          )
          .join("\n\n")}`
      : "No invitation links yet. Send /invite to create one.";
  }
  if (command === "/revokeinvite") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(argument))
      return "Send /revokeinvite followed by an invitation ID from /invites.";
    const status = await revokeInvitation(organizationId, userId, argument);
    return status === "forbidden"
      ? adminsOnly
      : status === "missing"
        ? "I couldn't find that invitation."
        : "Invitation revoked. Scouts who already joined stay on the team.";
  }
  const membership = await memberRole(organizationId, userId);
  return membership
    ? helpText(membership.role === "admin")
    : "Open the invitation link from your team admin to join, then send your scouting notes here.";
}

function helpText(admin: boolean) {
  const sections = [
    [
      "Scouting",
      "Send a note with the match and team number, for example:",
      "Q12 1241 climbed high",
      "",
      "/match <note> — match note (same as sending it without a command)",
      "/pit <note> — pit note",
      "/general <note> — general note",
      "/scout <event-id> [pit|general] <note> — note for a different event",
      "",
      "Notes go to the active event.",
    ],
    ["Events", "/event — show the active event", "/events — list events"],
    [
      "Flags",
      "/flag <team-number> [match-number] [note] — report a mistake in a saved note",
      "/flags — see your team's flags",
    ],
  ];
  if (admin)
    sections.push([
      "Admin",
      "/event set <season> <FRC code> — set the active event",
      "/event off — clear the active event",
      "/event help — all event commands",
      "/invite [label] — create a scout invitation link",
      "/invites — list invitation links",
      "/revokeinvite <id> — revoke an invitation",
    ]);
  return sections.map((lines) => lines.join("\n")).join("\n\n");
}
