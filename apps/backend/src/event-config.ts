import { requirements } from "@ai-scouting/scouting";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface EventConfig {
  name: string;
  season: number;
  type: "official" | "offseason" | "practice";
  source: "manual" | "frc_events" | "tba";
  startDate: string;
  endDate: string;
  timezone: string;
  attending: boolean;
  specificationVersion: string;
  validationMode: "off" | "warn" | "strict";
  frcEventCode: string | null;
  tbaEventKey: string | null;
}
export function parseEventConfig(input: unknown): EventConfig {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Event must be a JSON object.");
  const v = input as Record<string, unknown>;
  const allowed = new Set([
    "name",
    "season",
    "type",
    "source",
    "startDate",
    "endDate",
    "timezone",
    "attending",
    "specificationVersion",
    "validationMode",
    "frcEventCode",
    "tbaEventKey",
  ]);
  if (Object.keys(v).some((k) => !allowed.has(k)))
    throw Error("Unknown event configuration field.");
  const text = (key: string, max: number) => {
    const value = v[key];
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw Error(`Invalid ${key}.`);
    return value.trim();
  };
  const name = text("name", 120),
    timezone = text("timezone", 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw Error("Invalid timezone; use an IANA zone such as America/Toronto.");
  }
  const startDate = text("startDate", 10),
    endDate = text("endDate", 10);
  for (const date of [startDate, endDate]) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() < 1992 ||
      parsed.getUTCFullYear() > 2100 ||
      parsed.toISOString().slice(0, 10) !== date
    )
      throw Error("Invalid event date; use YYYY-MM-DD.");
  }
  if (endDate < startDate) throw Error("End date must not precede start date.");
  if (
    typeof v.season !== "number" ||
    !Number.isInteger(v.season) ||
    v.season < 1992 ||
    v.season > 2100
  )
    throw Error("Invalid season.");
  if (v.type !== "official" && v.type !== "offseason" && v.type !== "practice")
    throw Error("Invalid event type.");
  const source = v.source ?? "manual",
    validationMode = v.validationMode ?? "warn";
  if (source !== "manual" && source !== "frc_events" && source !== "tba")
    throw Error("Invalid source.");
  if (validationMode !== "off" && validationMode !== "warn" && validationMode !== "strict")
    throw Error("Invalid validationMode.");
  const specificationVersion = v.specificationVersion ?? requirements.version;
  if (specificationVersion !== requirements.version)
    throw Error(`Unsupported specification. Available: ${requirements.version}.`);
  if (v.attending !== undefined && typeof v.attending !== "boolean")
    throw Error("Invalid attending flag.");
  const external = (key: string) => {
    if (v[key] === undefined || v[key] === null) return null;
    if (typeof v[key] !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(v[key]))
      throw Error(`Invalid ${key}.`);
    return v[key];
  };
  const frcEventCode = external("frcEventCode"),
    tbaEventKey = external("tbaEventKey");
  if ((source === "frc_events" && !frcEventCode) || (source === "tba" && !tbaEventKey))
    throw Error("Selected source requires its external event identifier.");
  return {
    name,
    season: v.season,
    type: v.type,
    source,
    startDate,
    endDate,
    timezone,
    attending: v.attending ?? false,
    specificationVersion,
    validationMode,
    frcEventCode,
    tbaEventKey,
  };
}
