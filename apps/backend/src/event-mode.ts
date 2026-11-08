export type EventMode = "auto" | "on" | "off";
export interface WorkerEvent {
  start_date: Date | string;
  end_date: Date | string;
  timezone: string;
  attending: boolean;
  archived: boolean;
}
export function eventMode(env: NodeJS.ProcessEnv): EventMode {
  const mode = env.EVENT_MODE ?? "on"; // Preserve existing deployments until explicitly configured.
  if (mode !== "auto" && mode !== "on" && mode !== "off")
    throw Error("EVENT_MODE must be auto, on or off");
  return mode;
}
export function eventWindowActive(events: WorkerEvent[], now: Date): boolean {
  return events.some((event) => {
    if (!event.attending || event.archived) return false;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: event.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (key: string) => parts.find((p) => p.type === key)?.value;
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    const date = (value: Date | string) =>
      typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
    return today >= date(event.start_date) && today <= date(event.end_date);
  });
}

// No SQL or network timer while idle. Reload event windows on startup and accepted webhooks.
export function createWorkerControl(
  mode: EventMode,
  loadEvents: () => Promise<WorkerEvent[]>,
  clock = () => new Date(),
) {
  let events: WorkerEvent[] = [],
    burstUntil = 0,
    stopped = false;
  let refreshing: Promise<void> | undefined;
  let refreshRequested = false;
  return {
    get mode() {
      return mode;
    },
    active: () =>
      !stopped &&
      mode !== "off" &&
      (mode === "on" || clock().getTime() < burstUntil || eventWindowActive(events, clock())),
    async refresh() {
      if (mode !== "auto" || stopped) return;
      refreshRequested = true;
      if (!refreshing)
        refreshing = (async () => {
          while (refreshRequested && !stopped) {
            refreshRequested = false;
            events = await loadEvents();
          }
        })().finally(() => {
          refreshing = undefined;
        });
      await refreshing;
    },
    wake() {
      if (!stopped && mode === "auto") burstUntil = clock().getTime() + 120000;
    },
    stop() {
      stopped = true;
    },
  };
}
export type WorkerControl = ReturnType<typeof createWorkerControl>;
