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
  return `${e.name} (${e.season}${e.frc_event_code ? ` ${e.frc_event_code}` : ""})\n${date(e.start_date)}–${date(e.end_date)} · ${e.timezone}\nSpecification: ${e.specification_version}\nTBA: ${e.tba_event_key ?? "not linked (no unique automatic match yet)"}\nSchedule validation: ${e.validation_mode} (schedule checks not implemented yet)`;
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
    if (!context) return "Your account is not enrolled.";
    if (command === "event")
      return context.active
        ? `Active scouting event:\n${describe(context.active)}\n${context.active.id}\nNew notes use this event; existing sessions keep their event.`
        : "No active scouting event. New notes cannot be submitted. Ask an admin to use /event set <season> <FRC event code>.";
    return context.events.length
      ? "Most recent events (up to 15):\n" +
          context.events
            .slice(0, 15)
            .map(
              (e) =>
                `${e.name} (${e.season}${e.frc_event_code ? ` ${e.frc_event_code}` : ""})${e.archived ? " [archived]" : ""}${context.active?.id === e.id ? " [active]" : ""}\n${e.id}`,
            )
            .join("\n\n")
      : "No events configured. An admin can add one with /event set <season> <FRC event code>.";
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
      return `TBA event imported: ${id}. The active event is unchanged. If the event already exists under FIRST, link its TBA key explicitly instead.`;
    } catch {
      return "TBA event import failed; existing events retained. Check the key and backend TBA credentials.";
    }
  }
  const referenceCommand = /^(sync|reference|link-tba)\s+(\S+)(?:\s+(\S+))?$/i.exec(arg);
  if (referenceCommand) {
    const [, operation, eventId, source] = referenceCommand;
    if (!eventId || !uuidPattern.test(eventId)) return "Use an event ID from /events.";
    try {
      if (operation?.toLowerCase() === "reference") {
        const data = await readReference(organizationId, userId, eventId);
        const poll = data.schedulePoll;
        const schedule = poll?.received_at
          ? `Automatic schedule polling stopped: saved ${poll.received_at.toISOString()}.`
          : `Automatic schedule polling: ${poll?.status ?? "waiting for 6 p.m. on the first event day"}.${poll?.error ? ` ${poll.error}` : ""}`;
        const notifications = data.scheduleNotifications.length
          ? `\nAdmin notifications: ${data.scheduleNotifications.map((n) => n.status).join(", ")}.`
          : "";
        return `${data.teams.length} cached teams; ${data.matches.length} cached matches.\n${schedule}${notifications}\n${data.sync.map((s) => `${s.source}: ${s.status}, ${s.freshness}; last success ${s.succeeded_at?.toISOString() ?? "never"}`).join("\n") || "No full reference imports."}`;
      }
      if (operation?.toLowerCase() === "link-tba") {
        if (!source) return "Use /event link-tba <event-id> <TBA-event-key>.";
        await linkTbaEvent(organizationId, userId, eventId, source);
        return "TBA event key linked. Use /event sync <event-id> tba to import explicitly.";
      }
      if (source && source !== "frc_events" && source !== "tba")
        return "Source must be frc_events or tba.";
      const result = await syncReference(
        organizationId,
        userId,
        eventId,
        source === "tba" ? tbaProvider() : frcProvider(),
        30_000,
      );
      return result.status === "ok" || result.status === "partial"
        ? `Reference import ${result.status}: ${result.teams} teams; ${result.matches} matches.`
        : result.status === "skipped"
          ? "Reference import attempted recently; try again later."
          : "Reference import failed; cached data retained. Use /event reference <event-id> for status.";
    } catch {
      return "Reference command unavailable. An admin must select a team-owned event and configure the explicit provider link and credentials.";
    }
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
        if (cached.status === "ambiguous")
          return "Multiple local events have this FIRST code. Select the intended event by its ID from /events.";
        if (kind === "refresh" && !cached.event)
          return "Event is not stored yet. Add it first with /event add <season> <FRC code>.";
        if (cached.event?.source === "frc_events" && kind !== "refresh") {
          if (kind === "add")
            return cached.event.archived
              ? "Event is archived. Restore it before selecting it."
              : `Event already added: ${cached.event.name}. The active event is unchanged.`;
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
    else
      return "Event metadata comes from FIRST. Use /event add <season> <FRC code>, /event set <season> <FRC code>, or /event refresh <season> <FRC code>. Other commands: /event, /events, /event off, /event archive <id>, /event restore <id>.";
  }
  const result = await changeEvent(organizationId, userId, updateId, action);
  const tbaStatus =
    "config" in action
      ? `\n${result.tbaEventKey ? `TBA linked: ${result.tbaEventKey}.` : "TBA not linked. Check the backend API key and retry /event refresh; manual linking remains available."}`
      : "";
  switch (result.status) {
    case "forbidden":
      return "Only team admins can change event settings.";
    case "missing":
      return "Event unavailable. Events must belong to your team and be unarchived for selection.";
    case "active_event":
      return "Switch or clear the active event before archiving it.";
    case "ambiguous":
      return "Multiple local events have this FIRST code. Select the intended event by its ID from /events.";
    case "unsupported":
      return "This event or session uses an unsupported specification version.";
    case "ok":
      if (action.kind === "activate" || action.kind === "activate-frc")
        return result.eventId
          ? `Active scouting event set to ${result.eventName ?? result.eventId}. Existing sessions are unchanged.${tbaStatus}`
          : "Active event cleared. New notes cannot be submitted until an event is selected.";
      if (action.kind === "import-frc")
        return `Event added: ${result.eventName}. The active event is unchanged.${tbaStatus}`;
      if (action.kind === "refresh-frc")
        return `Event refreshed from FIRST: ${result.eventName}. Existing sessions and the active event are unchanged.${tbaStatus}`;
      return `Event ${action.kind === "archive" ? "archived" : "restored"}: ${result.eventId}`;
  }
}
