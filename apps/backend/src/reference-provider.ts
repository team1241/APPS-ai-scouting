import { parseEventConfig } from "./event-config.ts";
import { parseFrcReference } from "./frc-events.ts";

export type Source = "frc_events" | "tba";
export interface ReferenceTeam {
  number: number;
  name: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}
export interface Participant {
  number: number;
  station: string;
  surrogate: boolean;
}
export interface ReferenceMatch {
  key: string;
  stage: "qualification" | "playoff";
  round: string;
  set: number;
  number: number;
  scheduled: string | null;
  predicted: string | null;
  actual: string | null;
  completed: string | null;
  participants: Participant[];
  result: Record<string, unknown> | null;
}
export interface Snapshot {
  teams: ReferenceTeam[];
  matches: ReferenceMatch[];
  complete: boolean;
  eventFacts?: Record<string, unknown>;
}
export interface ReferenceProvider {
  source: Source;
  load(season: number, code: string): Promise<Snapshot>;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid provider object");
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid provider list");
  return value;
}
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("Invalid provider number");
  return Number(value);
}
function text(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid provider text");
  return value;
}
function epoch(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid timestamp");
  return new Date(value * 1000).toISOString();
}
function localTime(value: unknown): string | null {
  const s = text(value);
  if (s && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(s))
    throw new Error("Invalid FIRST local time");
  // FIRST supplies event-local wall time. Keep it verbatim; never interpret as server-local/UTC.
  return s;
}
function unique<T>(items: T[], key: (item: T) => string | number): T[] {
  if (new Set(items.map(key)).size !== items.length) throw new Error("Duplicate provider identity");
  return items;
}
export function normalizeFrcTeams(body: unknown) {
  const b = object(body);
  const teams = unique(
    list(b.teams).map((v) => {
      const t = object(v);
      return {
        number: positive(t.teamNumber),
        name: text(t.nameShort),
        city: text(t.city),
        region: text(t.stateProv),
        country: text(t.country),
      };
    }),
    (t) => t.number,
  );
  if (b.teamCountPage !== teams.length) throw new Error("Incomplete roster page");
  return {
    teams,
    page: positive(b.pageCurrent),
    pages: b.pageTotal === 0 ? 0 : positive(b.pageTotal),
    total: b.teamCountTotal,
  };
}
export function normalizeFrcSchedule(
  body: unknown,
  level: "Qualification" | "Playoff",
): ReferenceMatch[] {
  return unique(
    list(object(body).Schedule).map((v) => {
      const m = object(v);
      if (m.tournamentLevel !== level) throw new Error("Unexpected tournament level");
      const number = positive(m.matchNumber);
      const participants = unique(
        list(m.teams).map((v) => {
          const t = object(v);
          const station = text(t.station);
          if (!station || !/^(Red|Blue)[123]$/.test(station) || typeof t.surrogate !== "boolean")
            throw new Error("Invalid station");
          return { number: positive(t.teamNumber), station, surrogate: t.surrogate };
        }),
        (p) => p.station,
      );
      unique(participants, (p) => p.number);
      if (participants.length !== 6) throw new Error("Incomplete match participants");
      return {
        key: level === "Qualification" ? `qm:${number}` : `first:playoff:${number}`,
        stage: level === "Qualification" ? ("qualification" as const) : ("playoff" as const),
        round:
          level === "Qualification"
            ? "qm"
            : typeof m.description === "string" && /\(R[1-5]\)$/.test(m.description)
              ? (m.description.match(/\((R[1-5])\)$/)?.[1] ?? "first-playoff")
              : typeof m.description === "string" && /^(Einstein )?Final /.test(m.description)
                ? "final"
                : "first-playoff",
        set: 1,
        number,
        scheduled: localTime(m.startTime),
        predicted: null,
        actual: null,
        completed: null,
        participants,
        result: null,
      };
    }),
    (m) => m.key,
  );
}
export function normalizeTbaMatches(body: unknown, eventKey: string): ReferenceMatch[] {
  return unique(
    list(body).map((v) => {
      const m = object(v);
      const round = text(m.comp_level);
      if (m.event_key !== eventKey || !round || !["qm", "ef", "qf", "sf", "f"].includes(round))
        throw new Error("Unexpected TBA match");
      const number = positive(m.match_number),
        set = positive(m.set_number);
      const expectedKey = `${eventKey}_${round}${round === "qm" ? number : `${set}m${number}`}`;
      if (m.key !== expectedKey) throw new Error("Invalid TBA key");
      const alliances = object(m.alliances);
      const participants: Participant[] = [];
      for (const color of ["red", "blue"]) {
        const a = object(alliances[color]);
        const surrogates = list(a.surrogate_team_keys);
        list(a.team_keys).forEach((key, i) => {
          if (typeof key !== "string" || !/^frc[1-9]\d*$/.test(key) || i > 2)
            throw new Error("Invalid TBA team");
          participants.push({
            number: positive(Number(key.slice(3))),
            station: `${color === "red" ? "Red" : "Blue"}${i + 1}`,
            surrogate: surrogates.includes(key),
          });
        });
      }
      if (participants.length !== 6) throw new Error("Incomplete TBA participants");
      unique(participants, (p) => p.number);
      const scored = ["red", "blue"].every(
        (c) =>
          typeof object(alliances[c]).score === "number" && Number(object(alliances[c]).score) >= 0,
      );
      return {
        key: round === "qm" ? `qm:${number}` : `tba:${round}:${set}:${number}`,
        stage: round === "qm" ? ("qualification" as const) : ("playoff" as const),
        round,
        set,
        number,
        scheduled: epoch(m.time),
        predicted: epoch(m.predicted_time),
        actual: epoch(m.actual_time),
        completed: scored ? epoch(m.post_result_time) : null,
        participants,
        result: scored ? { alliances, scoreBreakdown: m.score_breakdown ?? null } : null,
      };
    }),
    (m) => m.key,
  );
}
async function request(
  url: string,
  headers: Record<string, string>,
  fetcher: typeof fetch,
): Promise<unknown> {
  try {
    const r = await fetcher(url, {
      headers: { accept: "application/json", ...headers },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    throw new Error("Reference provider request failed; cached data retained");
  }
}
export function frcProvider(fetcher: typeof fetch = fetch): ReferenceProvider {
  return {
    source: "frc_events",
    async load(season, code) {
      const ref = parseFrcReference(String(season), code);
      const user = process.env.FRC_EVENTS_USERNAME,
        key = process.env.FRC_EVENTS_AUTHORIZATION_KEY;
      if (!user || !key) throw new Error("FIRST credentials are not configured");
      const headers = {
        authorization: `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}`,
      };
      const base = `https://frc-api.firstinspires.org/v3.0/${ref.season}`;
      const eventBody = object(
        await request(`${base}/events?eventCode=${ref.code}`, headers, fetcher),
      );
      const listings = list(eventBody.Events);
      if (listings.length !== 1) throw new Error("Ambiguous FIRST event");
      const eventFacts = object(listings[0]);
      if (eventFacts.code !== ref.code) throw new Error("Unexpected FIRST event");
      const teams: ReferenceTeam[] = [];
      let pages = 1;
      let total: unknown;
      for (let page = 1; page <= pages; page++) {
        const data = normalizeFrcTeams(
          await request(`${base}/teams?eventCode=${ref.code}&page=${page}`, headers, fetcher),
        );
        if (
          data.page !== page ||
          data.pages > 100 ||
          (page > 1 && (pages !== data.pages || total !== data.total))
        )
          throw new Error("Unstable roster pagination");
        pages = data.pages;
        total = data.total;
        teams.push(...data.teams);
      }
      unique(teams, (t) => t.number);
      if (teams.length !== total) throw new Error("Incomplete roster");
      const matches: ReferenceMatch[] = [];
      for (const level of ["Qualification", "Playoff"] as const)
        matches.push(
          ...normalizeFrcSchedule(
            await request(
              `${base}/schedule/${ref.code}?tournamentLevel=${level}`,
              headers,
              fetcher,
            ),
            level,
          ),
        );
      const results = list(
        object(await request(`${base}/matches/${ref.code}`, headers, fetcher)).Matches,
      );
      for (const value of results) {
        const r = object(value);
        const identity =
          r.tournamentLevel === "Qualification"
            ? `qm:${positive(r.matchNumber)}`
            : r.tournamentLevel === "Playoff"
              ? `first:playoff:${positive(r.matchNumber)}`
              : null;
        const match = matches.find((m) => m.key === identity);
        if (!match) continue;
        match.actual = localTime(r.actualStartTime);
        match.completed = localTime(r.postResultTime);
        match.result = r;
      }
      return { teams, matches, complete: true, eventFacts };
    },
  };
}
export function tbaProvider(fetcher: typeof fetch = fetch): ReferenceProvider {
  return {
    source: "tba",
    async load(season, code) {
      if (!new RegExp(`^${season}[a-z0-9]+$`).test(code))
        throw new Error("Invalid explicit TBA event key");
      const key = process.env.TBA_AUTH_KEY;
      if (!key) throw new Error("TBA_AUTH_KEY is not configured");
      const base = `https://www.thebluealliance.com/api/v3/event/${code}`;
      const headers = { "X-TBA-Auth-Key": key };
      const eventFacts = object(await request(base, headers, fetcher));
      if (eventFacts.key !== code || eventFacts.year !== season)
        throw new Error("Unexpected TBA event");
      const teams = unique(
        list(await request(`${base}/teams`, headers, fetcher)).map((v) => {
          const t = object(v);
          return {
            number: positive(t.team_number),
            name: text(t.nickname),
            city: text(t.city),
            region: text(t.state_prov),
            country: text(t.country),
          };
        }),
        (t) => t.number,
      );
      return {
        teams,
        matches: normalizeTbaMatches(await request(`${base}/matches`, headers, fetcher), code),
        complete: true,
        eventFacts,
      };
    },
  };
}

export async function lookupTbaEvent(key: string, fetcher: typeof fetch = fetch) {
  if (!/^\d{4}[a-z0-9]+$/.test(key)) throw new Error("Invalid TBA event key");
  const auth = process.env.TBA_AUTH_KEY;
  if (!auth) throw new Error("TBA_AUTH_KEY is not configured");
  const e = object(
    await request(
      `https://www.thebluealliance.com/api/v3/event/${key}`,
      { "X-TBA-Auth-Key": auth },
      fetcher,
    ),
  );
  if (e.key !== key || e.year !== Number(key.slice(0, 4)))
    throw new Error("Unexpected TBA event identity");
  return parseEventConfig({
    name: e.name,
    season: e.year,
    source: "tba",
    tbaEventKey: key,
    type: e.event_type === 99 ? "offseason" : e.event_type === 100 ? "practice" : "official",
    startDate: e.start_date,
    endDate: e.end_date,
    timezone: e.timezone,
  });
}

// Automatic polling deliberately fetches only event metadata and schedules.
// A qualification schedule is sufficient; finals-only parents can use playoffs.
export function frcScheduleProvider(fetcher: typeof fetch = fetch): ReferenceProvider {
  return {
    source: "frc_events",
    async load(season, code) {
      const ref = parseFrcReference(String(season), code);
      const user = process.env.FRC_EVENTS_USERNAME,
        key = process.env.FRC_EVENTS_AUTHORIZATION_KEY;
      if (!user || !key) throw new Error("FIRST credentials are not configured");
      const headers = {
        authorization: `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}`,
      };
      const base = `https://frc-api.firstinspires.org/v3.0/${ref.season}`;
      const events = list(
        object(await request(`${base}/events?eventCode=${ref.code}`, headers, fetcher)).Events,
      );
      if (events.length !== 1 || object(events[0]).code !== ref.code)
        throw new Error("Unexpected FIRST event");
      let matches = normalizeFrcSchedule(
        await request(
          `${base}/schedule/${ref.code}?tournamentLevel=Qualification`,
          headers,
          fetcher,
        ),
        "Qualification",
      );
      if (!matches.length)
        matches = normalizeFrcSchedule(
          await request(`${base}/schedule/${ref.code}?tournamentLevel=Playoff`, headers, fetcher),
          "Playoff",
        );
      return { teams: [], matches, complete: true, eventFacts: object(events[0]) };
    },
  };
}
export function tbaScheduleProvider(fetcher: typeof fetch = fetch): ReferenceProvider {
  return {
    source: "tba",
    async load(season, code) {
      if (!new RegExp(`^${season}[a-z0-9]+$`).test(code)) throw new Error("Invalid TBA key");
      const key = process.env.TBA_AUTH_KEY;
      if (!key) throw new Error("TBA credentials are not configured");
      const headers = { "X-TBA-Auth-Key": key },
        base = `https://www.thebluealliance.com/api/v3/event/${code}`;
      const eventFacts = object(await request(base, headers, fetcher));
      if (eventFacts.key !== code || eventFacts.year !== season)
        throw new Error("Unexpected TBA event");
      const matches = normalizeTbaMatches(
        await request(`${base}/matches/simple`, headers, fetcher),
        code,
      ).map((m) => ({ ...m, actual: null, predicted: null, completed: null, result: null }));
      const qualifications = matches.filter((m) => m.stage === "qualification");
      return {
        teams: [],
        matches: qualifications.length ? qualifications : matches,
        complete: true,
        eventFacts,
      };
    },
  };
}
