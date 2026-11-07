import { eventCommand } from "./event-commands.ts";
import { uuidPattern } from "./event-config.ts";
import { flagUsage } from "./flag-command.ts";
import { readObservationFlags, submitObservationFlag } from "./repositories/flags.ts";
import {
  createInvitation,
  joinInvitation,
  listInvitations,
  revokeInvitation,
} from "./repositories/invitations.ts";
import { memberRole } from "./repositories/membership.ts";

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
    return "To request an investigation, use /flag <team-number> [match-number] [note]. You do not need to rewrite your scouting note.";
  if (command === "/flag") {
    const result = await submitObservationFlag({
      ...input,
      argument: input.text.replace(/^\/flag(?:@\w+)?\s*/i, ""),
      commandText: input.text,
    });
    if (result.status === "forbidden") return "Enroll with your team before flagging observations.";
    if (result.status === "invalid") return flagUsage;
    if (result.status === "missing")
      return "No finalized submission of yours matches that team/match. Check the numbers. An omitted match selects your latest finalized submission for that team, across events.";
    if (result.status === "ambiguous")
      return "Multiple submissions match that team and match, so no flag was created. Omit the match to flag your latest submission for this team, or ask an admin to investigate the specific submission.";
    const target = (await readObservationFlags(organizationId, userId, result.flag.id))?.[0];
    return `Flag ${result.duplicate ? "already recorded" : "recorded"} for team ${result.flag.team_number}${target ? ` · ${target.match_label ?? "unknown match"} · ${target.event_name.slice(0, 100)}` : ""}. Your submitted data is preserved. Everyone enrolled on your team can investigate it with /flags ${result.flag.id}.`;
  }
  if (command === "/flags") {
    if (argument && !uuidPattern.test(argument))
      return "Use /flags to list recent requests, or /flags <flag-id> to inspect one.";
    const flags = await readObservationFlags(organizationId, userId, argument || undefined);
    if (flags === null) return "Enroll with your team to view flag requests.";
    if (!flags.length) return argument ? "Flag request not found." : "No flag requests yet.";
    if (argument) {
      const flag = flags[0];
      if (!flag) return "Flag request not found.";
      return `Flag ${flag.id}\nTeam ${flag.team_number} · ${flag.match_label?.slice(0, 50) ?? "unknown match"} · ${flag.event_name.slice(0, 100)}\nScout: ${flag.scout_name.slice(0, 100)}\nSubmitted: ${flag.created_at.toISOString()}\nNote: ${flag.note ?? "No note supplied"}\nRevision: ${flag.revision_id} (${flag.revision_current ? "current" : "replaced"})\nSpecification: ${flag.specification_version.slice(0, 100)}\nOutcome: ${flag.outcome}\nRecorded data: ${JSON.stringify(flag.values).slice(0, 900)}\nThis request refers to that saved revision, even if it is later replaced.`;
    }
    // Keep Telegram replies below its message length limit. Details remain available by ID.
    return `Recent team flag requests (up to 20):\n${flags.map((flag) => `Team ${flag.team_number} · ${flag.match_label?.slice(0, 20) ?? "unknown match"} · ${flag.event_name.slice(0, 30)} · ${flag.scout_name.slice(0, 25)}\n/flags ${flag.id}`).join("\n\n")}`;
  }
  if (command === "/start" && argument.startsWith("join_")) {
    const token = argument.slice(5);
    if (!/^[A-Za-z0-9_-]{32}$/.test(token))
      return "This invitation is invalid or has been revoked. Ask your team admin for a new link.";
    const result = await joinInvitation(organizationId, userId, input.name, token);
    return result === "invalid"
      ? "This invitation is invalid or has been revoked. Ask your team admin for a new link."
      : result === "already_joined"
        ? "You are already enrolled. Send a scouting note whenever you're ready."
        : "You're enrolled as a scout. Send a note with the match and team number to get started.";
  }
  if (command === "/invite") {
    if ((await memberRole(organizationId, userId))?.role !== "admin")
      return "Only team admins can manage invitations.";
    if (!input.botToken) throw Error("Bot token required for invitation links");
    const r = await fetch(`https://api.telegram.org/bot${input.botToken}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const me = (await r.json()) as { ok?: boolean; result?: { username?: string } };
    if (!r.ok || !me.ok || !me.result?.username) throw Error("Could not resolve bot username");
    const invite = await createInvitation(organizationId, userId, input.updateId, argument);
    if (invite.status === "forbidden") return "Only team admins can manage invitations.";
    if (invite.status === "duplicate")
      return "This invitation command was already processed. Use /invites to see its ID, or send /invite again for a new link.";
    return `Reusable scout invitation:\nhttps://t.me/${me.result.username}?start=join_${invite.token}\n\nAnyone with this link can join as a scout. It stays active until revoked.\nRevoke: /revokeinvite ${invite.id}`;
  }
  if (command === "/invites") {
    const invites = await listInvitations(organizationId, userId);
    if (!invites) return "Only team admins can manage invitations.";
    return invites.length
      ? invites
          .map(
            (i) => `${i.label} — ${i.revoked_at ? "revoked" : "active"}, ${i.uses} joined\n${i.id}`,
          )
          .join("\n\n")
      : "No invitations yet. Use /invite to create a reusable link.";
  }
  if (command === "/revokeinvite") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(argument))
      return "Use /revokeinvite followed by the invitation ID from /invites.";
    const status = await revokeInvitation(organizationId, userId, argument);
    return status === "forbidden"
      ? "Only team admins can manage invitations."
      : status === "missing"
        ? "Invitation not found."
        : "Invitation revoked. Existing scouts remain enrolled.";
  }
  const membership = await memberRole(organizationId, userId);
  return membership
    ? `Send a scouting note with match and team number. Use /flag <team-number> [match-number] [note] to request a review, /flags to see team requests, /event to check context, /events to list events, or /scout <event-id> <note> for a delayed note. An active event is required for new notes.${membership.role === "admin" ? "\nAdmin commands: /invite [label], /invites, /revokeinvite <id>, /event set <season> <FRC code>, /event off" : ""}`
    : "Open your team's invitation link to enroll, then send a scouting note.";
}
