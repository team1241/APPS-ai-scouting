import type { Selectable } from "kysely";
import type { Event as ScoutingEvent } from "./db.generated.ts";
import { uuidPattern } from "./event-config.ts";
import { FrcEventsError, lookupFrcEvent, parseFrcReference } from "./frc-events.ts";
import { frcProvider, lookupTbaEvent, tbaProvider } from "./reference-provider.ts";
import { changeEvent, type EventAction, findFrcEvent, readEvents } from "./repositories/events.ts";
import {
  importTbaEvent,
  linkTbaEvent,
  readReference,
  syncReference,
} from "./repositories/reference.ts";

function date(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function describe(
  e: Pick<
    Selectable<ScoutingEvent>,
    | "name"
    | "frc_event_code"
    | "season"
    | "timezone"
    | "specification_version"
    | "validation_mode"
    | "start_date"
    | "end_date"
    | "tba_event_key"
  >,
) {
  return `${e.name} (${e.season}${e.frc_event_code ? ` ${e.frc_event_code}` : ""})\nDates: ${date(e.start_date)} to ${date(e.end_date)} (${e.timezone})\nSchedule check: ${validationModes[e.validation_mode as keyof typeof validationModes] ?? e.validation_mode}\nThe Blue Alliance: ${e.tba_event_key ?? "not linked yet"}\nSpecification: ${e.specification_version}`;
}
const validationModes = {
  off: "off",
  warn: "warn (scouts can save anyway)",
  strict: "strict (notes must match the schedule)",
};
const validationStatuses: Record<string, string> = {
  valid: "matches the schedule",
  missing_identity: "needs match or team",
  missing_schedule: "no schedule yet",
  stale_schedule: "schedule may be out of date",
  ambiguous_match: "unclear match",
  unknown_match: "match not in schedule",
  invalid_pairing: "team not in that match",
  incomplete_participants: "incomplete schedule",
  unknown_team: "team not at this event",
};
function validationSummary(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "not checked yet";
  const v = value as Record<string, unknown>;
  const status =
    typeof v.status === "string"
      ? (validationStatuses[v.status] ?? v.status.replaceAll("_", " "))
      : "not checked yet";
  return `${status}${v.conflictSessionId ? " · waiting for you to reply “keep separate”" : ""}${v.unverifiedConsent ? " · saving unverified" : ""}`;
}
export async function eventCommand(
  input: {
    organizationId: string;
    userId: string;
    updateId: string;
    text: string;
  },
  lookup: typeof lookupFrcEvent = lookupFrcEvent,
): Promise<string | null> {
  const match = /^\/(event|events)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(input.text.trim());
  if (!match) return null;
  const command = match[1]?.toLowerCase(),
    arg = match[2]?.trim() ?? "";
  const { organizationId, userId, updateId } = input;
  if (command === "events" || (command === "event" && !arg)) {
    const context = await readEvents(organizationId, userId);
    if (!context) return "You're not on a team yet. Ask your team admin for an invitation link.";
    if (command === "event") {
      const open = context.sessions.length
        ? `\n\nYour unfinished notes (latest 5):\n${context.sessions.map((s) => `• ${s.match_label ?? "match unknown"} · Team ${s.team_number ?? "unknown"} · ${s.name}\n  ${validationSummary(s.validation_result)}\n  Event ID: ${s.event_id}`).join("\n")}`
        : "";
      const schedule =
        context.schedule?.state === "saved"
          ? `saved ${context.schedule.receivedAt ? date(context.schedule.receivedAt) : ""}`.trim()
          : context.schedule?.state === "stale"
            ? "may be out of date"
            : "not available yet";
      return context.active
        ? `Active event:\n${describe(context.active)}\nMatch schedule: ${schedule}\nEvent ID: ${context.active.id}\n\nNew notes go to this event. Notes you've already started stay with their own event.\nIf the schedule changes later, an admin can update it with /event sync <event-id>.${open}`
        : `No event is active, so new notes can't be saved yet.\nAsk a team admin to set one with /event set <season> <FRC code>.${open}`;
    }
    return context.events.length
      ? "Recent events (up to 15):\n\n" +
          context.events
            .slice(0, 15)
            .map(
              (e) =>
                `${e.name} (${e.season}${e.frc_event_code ? ` ${e.frc_event_code}` : ""})${context.active?.id === e.id ? " · active" : ""}${e.archived ? " · archived" : ""}\n${e.id}`,
            )
            .join("\n\n")
      : "No events yet. An admin can add one with /event set <season> <FRC code>.";
  }
  const addTba = /^add-tba\s+(\d{4}[a-z0-9]+)$/.exec(arg);
  if (addTba?.[1]) {
    try {
      // Check membership/admin before sending any external request.
      const context = await findFrcEvent(
        organizationId,
        userId,
        Number(addTba[1].slice(0, 4)),
        "TBA",
      );
      if (context.status === "forbidden") return "Only team admins can import events.";
      const id = await importTbaEvent(organizationId, userId, await lookupTbaEvent(addTba[1]));
      return `Imported the event from The Blue Alliance. The active event hasn't changed.\nEvent ID: ${id}\n\nIf this event was already added from FIRST, link it with /event link-tba <event-id> <TBA key> instead.`;
    } catch {
      return "I couldn't import that event from The Blue Alliance, so nothing was changed. Check the event key, or ask whoever runs the server to check the TBA API key.";
    }
  }
  const referenceCommand = /^(sync|reference|link-tba)\s+(\S+)(?:\s+(\S+))?$/i.exec(arg);
  if (referenceCommand) {
    const [, operation, eventId, source] = referenceCommand;
    if (!eventId || !uuidPattern.test(eventId))
      return "That doesn't look like an event ID. Send /events to find one.";
    try {
      if (operation?.toLowerCase() === "reference") {
        const data = await readReference(organizationId, userId, eventId);
        const poll = data.schedulePoll;
        const schedule =
          poll?.received_at && poll.roster_received_at
            ? `Team list and schedule saved ${date(poll.received_at)}. Automatic checks have stopped.`
            : poll?.received_at
              ? `Schedule saved. Team list: ${poll.status === "received" ? "still waiting" : poll.status}.${poll.error ? ` ${poll.error}` : ""}`
              : `Automatic checks: ${poll?.status ?? "not started yet (they start at 6 p.m. on the first event day)"}.${poll?.error ? ` ${poll.error}` : ""}`;
        const notifications = data.scheduleNotifications.length
          ? `\nAdmin notifications: ${data.scheduleNotifications.map((n) => n.status).join(", ")}.`
          : "";
        const imports = data.sync.length
          ? `Imports:\n${data.sync.map((s) => `• ${s.source}: ${s.status}, ${s.freshness}, last success ${s.succeeded_at ? date(s.succeeded_at) : "never"}`).join("\n")}`
          : "No full imports yet.";
        return `Saved for this event: ${data.teams.length} teams, ${data.matches.length} matches.\nSchedule: ${data.scheduleState}.\n${schedule}${notifications}\n\n${imports}`;
      }
      if (operation?.toLowerCase() === "link-tba") {
        if (!source) return "Send /event link-tba <event-id> <TBA event key>.";
        await linkTbaEvent(organizationId, userId, eventId, source);
        return "Linked the TBA event key. To import teams and matches from TBA, send /event sync <event-id> tba.";
      }
      if (source && source !== "frc_events" && source !== "tba")
        return "The source must be frc_events or tba.";
      const result = await syncReference(
        organizationId,
        userId,
        eventId,
        source === "tba" ? tbaProvider() : frcProvider(),
        30_000,
      );
      return result.status === "ok" || result.status === "partial"
        ? `Import ${result.status === "ok" ? "finished" : "partly finished"}: ${result.teams} teams and ${result.matches} matches.`
        : result.status === "skipped"
          ? "An import ran recently. Please try again in a few minutes."
          : "The import failed, so your saved data hasn't changed. Send /event reference <event-id> for details.";
    } catch {
      return "I couldn't do that. Only admins can run this, and it needs one of your team's events with a linked data source and working API keys.";
    }
  }
  const validation = /^validation\s+(\S+)\s+(off|warn|strict)$/i.exec(arg);
  if (validation?.[1] && validation[2] && uuidPattern.test(validation[1])) {
    const mode = validation[2].toLowerCase() as "off" | "warn" | "strict";
    const result = await changeEvent(organizationId, userId, updateId, {
      kind: "validation",
      eventId: validation[1],
      mode,
    });
    return result.status === "ok"
      ? `Schedule check set to ${validationModes[mode]}.\nNotes are always saved as written. Unfinished notes use the new setting on their next reply.`
      : "Only team admins can change the schedule check for your team's events.";
  }
  let action: EventAction;
  {
    const sub = /^(\S+)(?:\s+([\s\S]*))?$/.exec(arg);
    const kind = sub?.[1]?.toLowerCase(),
      rest = sub?.[2]?.trim() ?? "";
    if (kind === "off" && !rest) action = { kind: "activate", eventId: null };
    else if (kind === "set" && uuidPattern.test(rest)) action = { kind: "activate", eventId: rest };
    else if (kind === "set" || kind === "add" || kind === "refresh") {
      const parts = rest.split(/\s+/);
      try {
        if (parts.length !== 2)
          throw new FrcEventsError(
            "Use /event set <season> <FRC event code>, for example /event set 2026 ONOSH.",
          );
        const reference = parseFrcReference(parts[0] ?? "", parts[1] ?? "");
        const cached = await findFrcEvent(organizationId, userId, reference.season, reference.code);
        if (cached.status === "forbidden") return "Only team admins can change event settings.";
        if (cached.status === "ambiguous") return ambiguousEvent;
        if (kind === "refresh" && !cached.event)
          return "That event isn't saved yet. Add it first with /event add <season> <FRC code>.";
        if (cached.event?.source === "frc_events" && kind !== "refresh") {
          if (kind === "add")
            return cached.event.archived
              ? "That event is archived. Restore it before selecting it."
              : `${cached.event.name} is already added. The active event hasn't changed.`;
          action = { kind: "activate", eventId: cached.event.id };
        } else {
          action = {
            kind:
              kind === "refresh" ? "refresh-frc" : kind === "add" ? "import-frc" : "activate-frc",
            config: await lookup(reference.season, reference.code),
          };
        }
      } catch (error) {
        if (error instanceof FrcEventsError) return error.message;
        throw error;
      }
    } else if ((kind === "archive" || kind === "restore") && uuidPattern.test(rest))
      action = { kind, eventId: rest };
    else return eventHelp;
  }
  const result = await changeEvent(organizationId, userId, updateId, action);
  const tbaStatus =
    "config" in action
      ? `\nThe Blue Alliance: ${result.tbaEventKey ? `linked (${result.tbaEventKey})` : "not linked. Try /event refresh again later, or link it with /event link-tba <event-id> <TBA key>."}`
      : "";
  switch (result.status) {
    case "forbidden":
      return "Only team admins can change event settings.";
    case "missing":
      return "That event isn't available. You can only select your team's events that aren't archived.";
    case "active_event":
      return "That's the active event. Switch to another event or clear it with /event off before archiving it.";
    case "ambiguous":
      return ambiguousEvent;
    case "unsupported":
      return "This event uses a specification version I don't support.";
    case "ok":
      if (action.kind === "activate" || action.kind === "activate-frc")
        return result.eventId
          ? `Active event set to ${result.eventName ?? result.eventId}. Notes you've already started stay with their own event.${tbaStatus}`
          : "Active event cleared. New notes can't be saved until an admin sets another one.";
      if (action.kind === "import-frc")
        return `Event added: ${result.eventName}. The active event hasn't changed.${tbaStatus}`;
      if (action.kind === "refresh-frc")
        return `Updated ${result.eventName} from FIRST. The active event and existing notes haven't changed.${tbaStatus}`;
      return action.kind === "archive" ? "Event archived." : "Event restored.";
  }
}

const ambiguousEvent =
  "More than one saved event uses this FIRST code. Send /events and pick the one you want by its ID.";

const eventHelp = [
  "Event commands",
  "/event — show the active event",
  "/events — list events",
  "",
  "Admin",
  "/event set <season> <FRC code> — set the active event, for example /event set 2026 ONOSH",
  "/event add <season> <FRC code> — add an event without making it active",
  "/event refresh <season> <FRC code> — update event details from FIRST",
  "/event off — clear the active event",
  "/event archive <event-id> — hide an event",
  "/event restore <event-id> — bring back an archived event",
  "/event validation <event-id> off|warn|strict — set how strictly notes are checked against the schedule",
  "/event sync <event-id> [frc_events|tba] — import teams and matches",
  "/event reference <event-id> — see saved teams, matches and imports",
].join("\n");
