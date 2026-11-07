export const schedulePollInterval = 10 * 60_000;
export function schedulePollingStarted(
  event: { start_date: Date | string; timezone: string; archived: boolean },
  now: Date,
): boolean {
  if (event.archived) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const start =
    typeof event.start_date === "string"
      ? event.start_date.slice(0, 10)
      : event.start_date.toISOString().slice(0, 10);
  return today > start || (today === start && Number(part("hour")) >= 18);
}
