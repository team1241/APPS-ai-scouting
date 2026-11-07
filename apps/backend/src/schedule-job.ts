import {
  frcScheduleProvider,
  type ReferenceProvider,
  type Snapshot,
  type Source,
  tbaScheduleProvider,
} from "./reference-provider.ts";
import {
  claimScheduleNotification,
  claimSchedulePoll,
  finishScheduleNotification,
  finishSchedulePoll,
  scheduleCandidates,
} from "./repositories/schedules.ts";

export async function runScheduleJob(
  organizationId: string,
  botToken: string,
  options?: {
    now?: Date;
    fetcher?: typeof fetch;
    providers?: { first: ReferenceProvider; tba: ReferenceProvider };
  },
) {
  const now = options?.now ?? new Date(),
    fetcher = options?.fetcher ?? fetch;
  const providers = options?.providers ?? {
    first: frcScheduleProvider(fetcher),
    tba: tbaScheduleProvider(fetcher),
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
        const snapshot = await provider.load(claim.event.season, code);
        snapshots.push({ source: provider.source, snapshot });
        if (snapshot.complete && snapshot.matches.length) break;
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
  // Notification retries are independent of polling; a saved schedule is never fetched again.
  for (let i = 0; i < 100; i++) {
    const notification = await claimScheduleNotification(organizationId, now);
    if (!notification) break;
    let outcome: Parameters<typeof finishScheduleNotification>[4] = { status: "uncertain" };
    try {
      const response = await fetcher(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: notification.telegram_user_id, text: notification.text }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (response.ok && body.ok === true) {
        outcome = { status: "sent" };
        notified++;
      } else if (body.ok === false) {
        const code = body.error_code ?? response.status;
        outcome =
          code === 429
            ? {
                status: "pending",
                retryAfterMs:
                  Math.max(60, Math.min(body.parameters?.retry_after ?? 600, 86400)) * 1000,
              }
            : code >= 500
              ? { status: "pending" }
              : { status: "failed" };
      }
    } catch {
      /* Avoid duplicates when Telegram may have accepted the message. */
    }
    await finishScheduleNotification(
      organizationId,
      notification.event_id,
      notification.telegram_user_id,
      notification.attempt_id,
      outcome,
      now,
    );
  }
  return { attempted, received, notified };
}
