import {
  createInvitation,
  joinInvitation,
  listInvitations,
  memberRole,
  revokeInvitation,
} from "./repositories/invitations.ts";

export async function telegramCommand(input: {
  organizationId: string;
  userId: string;
  updateId: string;
  text: string;
  name: string;
  botToken?: string;
}): Promise<string | null> {
  if (!input.text.startsWith("/")) return null;
  const [rawCommand, ...rest] = input.text.trim().split(/\s+/);
  const command = rawCommand?.split("@")[0]?.toLowerCase();
  const argument = rest.join(" ");
  const { organizationId, userId } = input;
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
    ? `Send a scouting note with match and team number.${membership.role === "admin" ? "\nAdmin commands: /invite [label], /invites, /revokeinvite <id>" : ""}`
    : "Open your team's invitation link to enroll, then send a scouting note.";
}
