import { findIana } from "windows-iana";
import { type EventConfig, parseEventConfig } from "./event-config.ts";

export class FrcEventsError extends Error {}
export function parseFrcReference(season: string, code: string) {
  const year = Number(season);
  if (
    !/^\d{4}$/.test(season) ||
    year < 2015 ||
    year > new Date().getUTCFullYear() ||
    !/^[a-z0-9]{1,80}$/i.test(code)
  )
    throw new FrcEventsError(
      "Use /event set <season> <FRC event code>, for example /event set 2026 ONOSH. FIRST supports seasons from 2015 through the current year.",
    );
  return { season: year, code: code.toUpperCase() };
}
export function normalizeFrcEvent(input: unknown, season: number, code: string): EventConfig {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new FrcEventsError("FIRST returned invalid event data.");
  const event = input as Record<string, unknown>;
  if (typeof event.code !== "string" || event.code.toUpperCase() !== code.toUpperCase())
    throw new FrcEventsError("FIRST returned a different event code; selection was not changed.");
  const knownOfficial = new Set([
    "Regional",
    "DistrictEvent",
    "DistrictChampionship",
    "DistrictChampionshipWithLevels",
    "DistrictChampionshipDivision",
    "ChampionshipSubdivision",
    "ChampionshipDivision",
    "Championship",
  ]);
  const offseason = event.type === "OffSeason" || event.type === "OffSeasonWithAzureSync";
  if (!offseason && !knownOfficial.has(String(event.type)))
    throw new FrcEventsError(
      "FIRST returned an unsupported event type. Check the event in FIRST before retrying.",
    );
  let timezone = typeof event.timezone === "string" ? event.timezone : "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    timezone = findIana(timezone)[0] ?? "";
  }
  try {
    return parseEventConfig({
      name: event.name,
      season,
      type: offseason ? "offseason" : "official",
      source: "frc_events",
      frcEventCode: event.code.toUpperCase(),
      startDate: typeof event.dateStart === "string" ? event.dateStart.slice(0, 10) : null,
      endDate: typeof event.dateEnd === "string" ? event.dateEnd.slice(0, 10) : null,
      timezone,
    });
  } catch {
    throw new FrcEventsError(
      "FIRST is missing a usable name, date or timezone. The active event was not changed; check the event details with FIRST.",
    );
  }
}
export async function lookupFrcEvent(
  season: number,
  code: string,
  options?: {
    username?: string;
    authorizationKey?: string;
    fetcher?: typeof fetch;
  },
): Promise<EventConfig> {
  const reference = parseFrcReference(String(season), code);
  const username = options?.username ?? process.env.FRC_EVENTS_USERNAME;
  const key = options?.authorizationKey ?? process.env.FRC_EVENTS_AUTHORIZATION_KEY;
  if (!username || !key)
    throw new FrcEventsError(
      "FRC Events API credentials are not configured on the backend. An administrator must configure FRC_EVENTS_USERNAME and FRC_EVENTS_AUTHORIZATION_KEY.",
    );
  const url = new URL(`https://frc-api.firstinspires.org/v3.0/${reference.season}/events`);
  url.searchParams.set("eventCode", reference.code);
  let response: Response;
  try {
    response = await (options?.fetcher ?? fetch)(url, {
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${username}:${key}`).toString("base64")}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new FrcEventsError(
      "FRC Events could not be reached. Try again; the active event was not changed.",
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new FrcEventsError(
      "FIRST rejected the configured API credentials. Ask an administrator to check them.",
    );
  if (response.status === 404)
    throw new FrcEventsError(
      `FIRST has no event ${reference.code} for ${season}. Check the season/code; some offseason events may not be available through FIRST.`,
    );
  if (!response.ok)
    throw new FrcEventsError(
      "FRC Events lookup failed. Try again; the active event was not changed.",
    );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FrcEventsError("FIRST returned invalid JSON; the active event was not changed.");
  }
  const events = body && typeof body === "object" && "Events" in body ? body.Events : undefined;
  if (!Array.isArray(events)) throw new FrcEventsError("FIRST returned invalid event listings.");
  if (events.length === 0)
    throw new FrcEventsError(
      `FIRST has no event ${reference.code} for ${season}. Check the season and code in FIRST.`,
    );
  if (events.length !== 1)
    throw new FrcEventsError("FIRST returned multiple events; selection was not changed.");
  return normalizeFrcEvent(events[0], season, reference.code);
}
