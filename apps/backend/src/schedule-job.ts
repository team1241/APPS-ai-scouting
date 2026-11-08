import { drainOutbound } from "./outbound-worker.ts";
import {
  frcAcquisitionProvider,
  type ReferenceProvider,
  type Snapshot,
  type Source,
  tbaAcquisitionProvider,
} from "./reference-provider.ts";
import {
  claimSchedulePoll,
  finishSchedulePoll,
  scheduleCandidates,
} from "./repositories/schedules.ts";

export async function runScheduleJob(
  organizationId: string,
  botToken: string,
  options?: {
    now?: Date;
    deliver?: boolean;
    fetcher?: typeof fetch;
    providers?: { first: ReferenceProvider; tba: ReferenceProvider };
  },
) {
  const now = options?.now ?? new Date(),
    fetcher = options?.fetcher ?? fetch;
  const providers = options?.providers ?? {
    first: frcAcquisitionProvider(fetcher),
    tba: tbaAcquisitionProvider(fetcher),
  };
  let attempted = 0,
    received = 0,
    notified = 0;
  for (const candidate of await scheduleCandidates(organizationId)) {
    const claim = await claimSchedulePoll(organizationId, candidate.id, now);
    if (!claim) continue;
    attempted++;
    const snapshots: { source: Source; snapshot: Snapshot }[] = [];
    let failed = false;
    for (const [provider, code] of [
      [providers.first, claim.event.frc_event_code],
      [providers.tba, claim.event.tba_event_key],
    ] as const) {
      if (!code) continue;
      try {
        const load = claim.rosterOnly ? provider.loadRoster : provider.load;
        if (!load) throw new Error("Roster-only import is unavailable");
        const snapshot = await load(claim.event.season, code);
        snapshots.push({ source: provider.source, snapshot });
        if (
          snapshot.complete &&
          snapshot.teams.length &&
          (claim.rosterOnly || snapshot.matches.length)
        )
          break;
      } catch {
        failed = true;
      }
    }
    if (
      await finishSchedulePoll(
        organizationId,
        candidate.id,
        claim.attemptId,
        snapshots,
        failed,
        now,
      )
    )
      received++;
  }
  if (options?.deliver !== false)
    notified = await drainOutbound(organizationId, botToken, fetcher, options?.now);
  return { attempted, received, notified };
}
