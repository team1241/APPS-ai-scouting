# Event-day reliability and recovery (#10)

## Worker modes and Railway

`EVENT_MODE=on|auto|off` is a deployment override, independent of `/event off` (new-note admission). Default `on` preserves existing deployments; configure every HTTP/recovery/schedule service consistently.

- `on`: claim extraction and outbound work every five seconds. `EXTRACTION_ENABLED` still independently controls extraction.
- `auto`: process throughout the inclusive local calendar dates of attended, non-archived events. Successful authenticated webhooks open two-minute processing bursts for delayed notes/replies. Outside those windows the process makes no queue-polling queries. Windows load at startup and after webhooks; changes made through other tooling require the next webhook or restart. No database refresh timer runs while idle.
- `off`: stop new extraction/delivery claims, including cron delivery. Intake and schedule acquisition still persist. In-flight work finishes. Environment changes need deployment/restart; off is not cancellation or a billing cap.

`/health` makes no database query and reports mode/current activation. `/health/db` wakes compute. Cached-date timers cannot wake a sleeping container. Backend sessions remain authoritative; cached Mastra turns replay and suspended runs resume, while running/failed Mastra executions require operator inspection. Never create a replacement run or resume a completed session merely to recover a notification.

Decision: retain Railway, Neon and Mastra. For live events use `on`, Railway Serverless disabled, and initially one extraction worker/one Mastra instance. No provider or paid-plan changes are made here. Idle `auto` can allow Railway Serverless sleep. Railway detects outbound packets including database traffic; an inbound request wakes the service, and the first cold request may return 502. Actual sleep/settings remain unverified. [Railway Serverless](https://docs.railway.com/deployments/serverless).

For retry recovery while HTTP sleeps, configure a separate Railway cron service with runtime database, organization, bot and enabled extraction's Mastra configuration:

```text
Start: pnpm --filter @ai-scouting/backend worker:run
Cron: */10 * * * *
```

It attempts at most three extractions and ten deliveries, closes the pool and exits. In auto it recovers outside event windows; off skips without opening a database connection. Nominal recovery delay includes the next ten-minute run, retry timing, backlog and platform delays; this is not an SLA. Railway skips runs when the previous execution remains active. Inspect stuck runs. [Cron execution requirements](https://docs.railway.com/cron-jobs).

Keep the existing separate `schedule:sync` cron. Recovery never invokes FIRST/TBA. Schedule acquisition remains one-time; delivery retries never refetch saved schedules/rosters. Off pauses schedule delivery, not acquisition. Idle cron runs still incur compute and wake Neon; disable/narrow acquisition schedules only after checking future events' initial acquisition needs.

SIGTERM/SIGINT stops new claims, closes HTTP and waits for in-flight passes, with a 25-second shutdown deadline. Configure Railway's draining period accordingly. Longer model work can exceed that deadline and relies on persisted recovery; killed sends become ambiguous after lease expiry.

## Operational measurements

From backend with trusted host access and restricted runtime credentials:

```sh
node --env-file=.env src/operations.ts <organization-id> <telegram-admin-id>
```

The tenant-admin-authorized typed snapshot reports extraction/outbound state counts, attempt-budget counts, due deliveries, oldest queued/due timestamps, stale leases, maximum recorded delivery latency and latest schedule attempt/receipt timestamps. It excludes note text and recipient identities. Queue lag is measuredAt minus oldestDueAt; scheduled future retries are not overdue. Delivery latency measures recorded acceptance, not reading. Extraction counters reset on follow-up and are not lifetime model usage. Reports run on demand, not another database polling/alerting service. Use #6's delivery CLI for recipient details and controlled retries.

Use existing native Mastra observability for input/output tokens and estimated costs. Installed total metrics are `mastra_model_total_input_tokens` and `mastra_model_total_output_tokens`; detail/cache metrics overlap, so do not sum totals and details. Use Metrics/Traces or the [Mastra Metrics API](https://mastra.ai/blog/introducing-metrics-api-for-mastra-platform) scoped to production and the reporting period. Missing/unpriced metrics remain unknown. Backend service tokens cannot administer observability. Provider invoices remain authoritative.

For one UTC reporting interval, collect Neon CU-hours across dev/prod computes, storage, Railway measured RAM/CPU/egress and subscription minimum, Mastra CPU-hours/events/egress and allowance remaining, and Anthropic billed token/cache usage. Record before/after totals and projected overages without credentials or scouting content. Local runtime cannot be converted into measured Neon compute or cloud charges.

## Disposable evidence and reproduction

The user selected a simulated workload. [Simulation](evidence/gh10-simulation.json): 120 synthetic notes, four recipients and 120 immutable final revisions. Mock 503 failures retry, one recipient is unreachable, and a crashed sender becomes ambiguous: 89 sent, 30 failed, one ambiguous, with no repeat extraction or revision loss. Local CPU/RSS/wall time are measured; retry time advances virtually. No real Telegram/model calls or cloud charges are measured.

[Restore evidence](evidence/gh10-restore.json) compares every table's row fingerprint, public RLS flags and immutable/outbox triggers after a full database dump/restore including Mastra. A separate native Postgres-adapter drill then verifies restored suspended-turn replay without extraction and follow-up resumption with deferred finalization. This verifies portable application/snapshot recovery, not account PITR, external backup storage, role grants or production RTO/RPO.

Use dedicated empty local `scouting_gh10_*` databases with matching Postgres client tools:

```sh
export DATABASE_URL='<local-source-url>'
export RESTORE_DATABASE_URL='<different-empty-local-target-url>'
pnpm db:migrate
node apps/backend/src/reliability-simulation.ts /tmp/event-simulation.json
node apps/mastra/src/recovery-drill.ts seed
node scripts/restore-drill.mjs /tmp/restore-drill.json
DATABASE_URL="$RESTORE_DATABASE_URL" node apps/mastra/src/recovery-drill.ts verify
```

Scripts reject remote URLs and nonempty restore targets. CI runs them and uploads summary reports only. The temporary dump is deleted; remove fixture databases afterward. Real backups contain sensitive notes and identities: encrypt, restrict access, set retention and store outside ephemeral app filesystems.

## Backup and incident runbook

Verify Neon's actual plan/history window covers the event; do not assume Free retention. Use a direct/unpooled administrative connection and one consistent full-database snapshot covering public and mastra. Separate per-schema snapshots can break consistency. Preserve role definitions/grants through a separate reviewed process; the portable drill intentionally omits them. [Neon backups](https://neon.com/docs/postgres/backup-restore/backups) and [history window](https://neon.com/docs/postgres/backup-restore/history-window).

1. Pause webhook ingress and stop/drain all workers and crons before recovery/cutover. Set off everywhere; a new env setting does not affect a still-running old container.
2. Restore into an isolated branch/database, retaining original data/outbound ledger. Record incident time, recovery point, possible lost-intake interval and compatible application/Mastra revisions.
3. Verify raw entries/replies, drafts, publications, immutable revisions/flags, event/specification links, acquisition receipts and Mastra snapshots. Apply compatible migrations and restore runtime grants. Test restricted-role RLS; owner access is not an isolation test.
4. Before any worker resumes, quarantine restored pending/sending deliveries for every tenant:

   ```sh
   node --env-file=.env src/operations.ts <organization-id> <telegram-admin-id> quarantine-restored 'Incident reference and snapshot time'
   ```

   The authorized operation records interventions and marks rows ambiguous. Restoring rewinds the ledger, but cannot rewind Telegram: a restored pending message may already have been sent. Reconcile original ledger/chat history, then use #6's controlled retries. Never blindly drain a restored backlog. Missing post-snapshot jobs need original records; their delivery cannot safely be guessed.
5. Inspect running/failed Mastra runs; verify cached replay, original event/specification and follow-up using a dev bot. Ensure completion does not fork revisions.
6. After authorization, cut over runtime connections, restore ingress, enable workers gradually and monitor snapshots. Record observed recovery duration and data-loss interval. Telegram cannot be assumed to reconstruct all post-snapshot notes or lost acknowledgments.

Proposed planning objectives: recover within 30 minutes; lose no committed notes in a process-only crash. These are not verified production RTO/RPO. Database rollback can lose changes after its recovery point. Verify the real backup/history policy and an isolated Neon restore before setting an RPO.

## Live release verification remains open

No production deployment, paid-plan change or notifications are authorized by the simulated drill. Keep #10 open until an authorized rollout records Railway Wait for CI for HTTP/cron, actual prevention of deploy after readiness/migration failure, deployed health revision matching main, actual wake/recovery behavior, provider usage/overages and an isolated Neon restore with runtime grants. [Wait for CI](https://docs.railway.com/deployments/github-autodeploys#wait-for-ci) evaluates workflow conclusions; repository configuration alone does not prove service settings. No new schema/Mastra contract is required; #6's migration must already be present. Configure all services together and test dev-bot behavior before event reliance.

## Budget update (USD, checked 2026-11-07)

The approximate $20/month goal remains a planning target, not a measured bill or spending guarantee. The simulated event cost $0 in external model/Telegram requests; cloud CU-hours, billed tokens and platform usage are explicitly null in its artifact. Its 181 MiB local peak RSS and sub-second fake-provider runtime are useful regression evidence, not Railway allocation/CPU predictions.

For planning, assume Railway Hobby's $5 monthly minimum, 0.25 GB average RAM and 0.05 average vCPU for a 30-day month across backend/cron usage, 2,000 extraction attempts at 2,000 input + 500 output tokens, one 48-hour event using 0.25 Neon CU, 1 GB-month database storage, and no already-consumed Mastra allowances. These are explicit assumptions requiring replacement with provider measurements.

Railway resource arithmetic is $2.50 RAM + $1 CPU, so the minimum applies ($5), before egress/other workspace services. Haiku 5.5's current short-prompt rates give $0.00045 per extraction: $0.054 for 120 simulated-equivalent calls or $0.90 for 2,000 assumed attempts. Neon event compute is 12 CU-hours; on Launch, $1.272 plus $0.35 storage is $1.622 before other branches/history/idle recovery. On Free, verify remaining project allowances rather than assuming another free allowance for development. Mastra Starter includes 24 CPU-hours, 100K observability events and 10 GB egress; excess costs are additive and not measured by this simulation. Do not assume a CPU-hour equals an elapsed hour or that a logical note emits only one observability event.

Under those inputs the identified Railway/model/Launch subtotal is $7.522, leaving about $12.48 of the $20 goal for Mastra excess, additional database usage, egress and other costs. This is an incomplete modeled subtotal, not a measured forecast. Continuous 0.25-CU Neon activity for 720 hours is 180 CU-hours ($19.08 Launch compute alone), so idle polling can break the target. Account-wide dev/prod and cron traffic must be included. Alert below the $20 target using provider spend controls; hard limits may stop event service, and no paid tier/automatic top-up is enabled by this change.

Pricing sources: [Railway rates/minimum](https://docs.railway.com/pricing/plans), [Neon pricing](https://neon.com/pricing), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Mastra allowances](https://mastra.ai/blog/mastra-platform-pricing). Recheck the actual subscribed plans before event deployment. Replace assumptions with one real event's native token metrics and hosting usage before declaring the goal achieved.
