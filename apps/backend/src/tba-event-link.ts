import type { EventConfig } from "./event-config.ts";

// Use TBA's declared FIRST code, not its own event_code/key. In particular,
// FIRST ARCHIMEDES corresponds to TBA arc; championship parents and divisions
// must remain distinct. Dates may be narrower in TBA for parent-event finals.
export function matchingTbaEventKey(event: EventConfig, body: unknown): string | null {
  if (!Array.isArray(body) || !event.frcEventCode) return null;
  const candidates = body.filter((candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const e = candidate as Record<string, unknown>;
    const compatibleType =
      event.type === "official"
        ? typeof e.event_type === "number" && [0, 1, 2, 3, 4, 5].includes(e.event_type)
        : e.event_type === (event.type === "offseason" ? 99 : 100);
    return (
      e.year === event.season &&
      typeof e.first_event_code === "string" &&
      e.first_event_code.toUpperCase() === event.frcEventCode?.toUpperCase() &&
      typeof e.key === "string" &&
      new RegExp(`^${event.season}[a-z0-9]+$`).test(e.key) &&
      compatibleType &&
      typeof e.start_date === "string" &&
      /^\d{4}-\d\d-\d\d$/.test(e.start_date) &&
      typeof e.end_date === "string" &&
      /^\d{4}-\d\d-\d\d$/.test(e.end_date) &&
      e.start_date <= e.end_date &&
      e.start_date <= event.endDate &&
      e.end_date >= event.startDate
    );
  });
  return candidates.length === 1 ? (candidates[0].key as string) : null;
}

export async function discoverTbaEventKey(
  event: EventConfig,
  options?: { authorizationKey?: string; fetcher?: typeof fetch },
): Promise<string | null> {
  const key = options?.authorizationKey ?? process.env.TBA_AUTH_KEY;
  if (!key || !event.frcEventCode || event.tbaEventKey) return event.tbaEventKey;
  try {
    const response = await (options?.fetcher ?? fetch)(
      `https://www.thebluealliance.com/api/v3/events/${event.season}`,
      {
        headers: { accept: "application/json", "X-TBA-Auth-Key": key },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return null;
    return matchingTbaEventKey(event, await response.json());
  } catch {
    // TBA supplementation must never prevent creating/using the FIRST event.
    return null;
  }
}
