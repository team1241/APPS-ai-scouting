# Operations guide

The [system specification](system-specification.md) owns architecture, environment identities, costs, reliability limitations, and future behavior. Use [development](development.md) for local setup and tests.

## Production configuration

Configure the backend on Railway with its production bot token, webhook secret, organization ID, restricted pooled `DATABASE_URL`, `MASTRA_URL`, matching `MASTRA_SERVICE_TOKEN`, and `EXTRACTION_ENABLED=true`. Use each app's `.env.example` as the variable reference. Never use the production bot or database for local tests.

Mastra Platform receives the production `ANTHROPIC_API_KEY`, `MASTRA_DATABASE_URL`, and the same application service token. This token is not a platform-wide deployment credential. Backend requests require HTTPS, refuse redirects, and authorize only the authenticated session endpoint; Studio retains platform authentication. Startup validates required extraction configuration before the backend listens.

Mastra's database login has USAGE/CREATE only in its dedicated schema; the administrator owns the schema and the adapter creates its tables. Development uses a separate login/branch. PUBLIC access to `public` and `mastra` is revoked; explicitly grant runtime permissions and review future schemas for equivalent isolation. Backend runtime cannot migrate or administer roles. Keep administrative migration credentials out of deployed runtime configuration.

Ignored `apps/backend/.env.render` is a local transfer aid for production runtime settings, not a complete deployment environment or a source-controlled secret store.

## Release workflow

GitHub Actions `Production readiness` runs on pushes to `main` or manual dispatch. The workflow file is the authoritative check list. The production owner/unpooled connection belongs in the repository secret `PRODUCTION_MIGRATION_DATABASE_URL` and is exposed only to migration verification. Jobs serialize migrations without cancelling a running migration. Generated types must match the migrated database.

Enable Railway **Wait for CI** for the GitHub-linked backend service, so the existing production migration workflow finishes successfully before Railway deploys. This setting must be verified in Railway; it is not set by the repository workflow. A failed migration must block deployment; resolve it before any manual rollout. Keep schema changes compatible with the previous application during rollout. Do not add migrations to the production start command or give the runtime role owner permissions.

Mastra has a separate deployment lifecycle. Deploy compatible agent contracts before enabling a backend that depends on them, then smoke-test authorized extraction and rejected unauthorized requests. When using a deployment env-file, include only intended production overlays; never upload the entire local development environment. Keep the pnpm build-compatibility check described in development.

Register the production Telegram webhook against the Railway backend's `/telegram/webhook` with the configured secret. `/health` checks process availability; `/health/db` checks database access. Check webhook status/pending updates and processing failures when diagnosing missing replies. Do not expose credential values in logs or diagnostic output.

## Invitations and membership

In a private bot chat, an enrolled admin can use:

- `/invite [label]`: create a reusable scout enrollment link.
- `/invites`: list the 20 newest invitation IDs, labels, usage counts, and status.
- `/revokeinvite <id>`: disable further joins without removing enrolled members.

Share the returned link with the intended team. Each user opens it and taps Start. Links have no expiry or usage cap; forwarded links work until revoked. Joining repeatedly neither duplicates membership nor changes an existing role. Only token hashes are stored, so keep the original creation response: listing cannot recover the link. If that response is lost, create a fresh invitation and revoke the old one by ID. Duplicate creation updates do not create extra links.

Commands bypass extraction. Group chats cannot create or redeem invitations. Other-organization tokens are rejected. Concurrent joining/revocation is serialized in database transactions. Enrollment grants scout access; initial admins and role changes require an administrative path.

Invitation rollout requires both invitation migrations, including the restricted runtime permission grant, before backend deployment. No invitation-specific environment variable is needed. Test the dev bot before production.


## Durable-session rollout

Apply the scouting-session migration through the migration pipeline. Deploy Mastra first with `MASTRA_DATABASE_URL` and the authenticated `/scouting/sessions/:runId/turn` endpoint, then deploy the backend worker. The legacy extraction endpoint has been removed; older backends must be upgraded to the session client. Test a note requiring several replies and verify one run ID persists across them. Existing records without event context are retained for history and are not automatically assigned or replayed.

Open sessions pin their specification version: finish them before changing the template version or provide an explicit migration. Failed provider calls remain resumable; inspect runs left running/failed after interruption before manual recovery. The retry coalescer is process-local; keep one backend worker/one Mastra instance initially and do not assume distributed exactly-once execution. Delivery of questions still has the existing send/commit ambiguity.


## Events

Enrolled users can inspect `/event` (current context) and `/events` (15 most recent events, with FIRST codes and internal IDs). Admins normally select events by season and FIRST code:

```text
/event set 2026 ONOSH
```

The backend fetches the event's name, dates, type and timezone, stores it, and activates it. Configure `FRC_EVENTS_USERNAME` and `FRC_EVENTS_AUTHORIZATION_KEY` on that backend first; credentials stay server-side. A cached event is reused without another API call, preserving its internal ID and local settings. Failed lookups leave the active event unchanged. Archived events must be restored explicitly. FIRST is the only lookup source in this slice; TBA supplementation and roster/schedule imports follow in issue #2.

Event metadata is created and refreshed only through FIRST. Raw JSON creation/editing is not supported. For events absent from FIRST, no local event is created; TBA support can be added as a separate provider later.

| Command                              | Action                                            |
| ------------------------------------ | ------------------------------------------------- |
| `/event add <season> <FRC code>`     | Import an event without changing the active event |
| `/event set <season> <FRC code>`     | Import/select and activate an event               |
| `/event refresh <season> <FRC code>` | Refresh an existing event's metadata from FIRST   |
| `/event set <event-id>`              | Select an already stored event                    |
| `/event off`                         | Clear the active event                            |
| `/event archive <event-id>`          | Archive an inactive event                         |
| `/event restore <event-id>`          | Restore an archived event                         |

Codes are case-insensitive. Refresh updates name, dates, type, and timezone from FIRST, preserving the event ID, linked sessions, attendance setting, specification version, validation mode, and archive state. It does not change the active event. Cached selection uses stored metadata; use refresh explicitly to retrieve changes. Missing/invalid provider data leaves existing records and selection unchanged. Archived events may be refreshed but must be restored before selection.

New events use the supported `starter-match-v1` specification and default warning validation mode. Schedule validation is implemented as described below. Attendance is an organization setting, not inferred from FIRST event metadata. There is no generic metadata update endpoint or JSON command.

Changing the active event applies only to new notes. Existing sessions and replies keep their original event and specification, even after that event is archived. Switch or clear the active event before archiving it. Changes are tenant-scoped and repeated Telegram command deliveries reuse their original result.

New scouting notes require a valid active event. Without one, the bot rejects the submission and asks the scout to have an admin select an event, then resend. Rejected text is not stored as a raw note or session. Only the delivery identifier and rejection reason are retained so a later Telegram retry cannot attach the rejected note to a different event. `/eventassign` and `/unassigned` are not supported.

Follow-ups to an existing event-bound session continue with its original event even if the active event is changed or cleared. Historical eventless records remain unchanged; a reply to such a session is rejected with instructions to resend the complete note under an active event. Accepted-delivery retries remain duplicates even after scouting is paused.

For a delayed note from another event, use `/scout <event-id> <note text>`. This selects an event for that note without changing the team's default. An active event is still required. Unavailable, archived, or unsupported selected events are rejected without storing the note. A malformed `/scout` command returns usage without creating a scouting entry. Event selection is explicit; receive time is never used to guess its event.

Deploy the event migration before the backend. On rollout, historical eventless sessions retain their original data and cannot be resumed through event assignment. Configure the active event before collecting new notes; scouts must resend any incomplete eventless notes as new submissions. The dev bot and dev database are the first validation environment; production is not changed by local setup.


### Event feature release checklist

1. Complete the [local event-flow verification](development.md#local-event-flow-verification).
2. Configure `FRC_EVENTS_USERNAME` and `FRC_EVENTS_AUTHORIZATION_KEY` in the production Railway backend. Local `.env` credentials are not deployed automatically.
3. Merge the reviewed change. Verify Production readiness applies all migrations and checks generated types before Railway deploys; keep Wait for CI enabled.
4. Confirm Railway's `/health` reports the intended commit and `/health/db` succeeds.
5. In the production bot, use an enrolled admin account to select the intended season/code with `/event set`, then inspect `/event` before asking scouts to submit notes.
6. Verify one complete submission/follow-up and its private workflow recovery state. Retain historical eventless records without assigning them automatically.

This event feature changes only the backend and database; the existing deployed session workflow already provides its extraction contract. Future changes to that contract still require coordinated Mastra/backend deployment as described above.

## Reference imports (#2)

Apply `20261107180000_reference_imports`, `20261107190000_reference_event_facts`, `20261107200000_schedule_polling`, and `20261107210000_roster_acquisition` before deploying. Existing manual events and organization/session settings remain usable. Admins can explicitly import cached rosters, schedules, participants and official results:

```text
/event sync <event-id> frc_events
/event reference <event-id>
/event link-tba <event-id> <explicit-TBA-event-key>
/event sync <event-id> tba
/event add-tba <TBA-event-key>
```

Creating a FIRST event automatically looks up TBA using its declared `first_event_code`, matching season, event category and overlapping dates. A unique match is saved on the new event, including differing Worlds provider keys. TBA must have `TBA_AUTH_KEY` configured. Missing, ambiguous, conflicting or failed matches leave FIRST usable and the event visibly unlinked. `/event refresh <season> <FIRST-code>` retries missing links; existing links are preserved. Use `link-tba` only as a manual fallback for an existing FIRST event. `add-tba` creates a separate event for supplemental coverage when FIRST has no event; it does not infer corresponding FIRST codes. TBA requires backend `TBA_AUTH_KEY`. Replacing a previously linked TBA key is refused because its cache requires reconciliation. Select imported events with `/event set <event-id>`.

Imports upsert stable team/match IDs, retain older records absent from new responses, and store each source's facts separately. FIRST takes precedence; null FIRST fields can use TBA values. Backend `overrideReference` supports admin fact overrides; pass an empty object to clear an override. No manual event JSON editing is introduced. `readReference` returns effective facts and sync status/freshness through tenant-authorized operations. Missing sync rows mean absent data; older successes or failed refreshes mean stale data. A first successful roster/schedule save queues one acquisition notification for each enrolled Telegram admin. Historical results never generate match notifications.

Qualification identity is shared by explicit event linkage and qualification number. For verified 2026 event types and TBA playoff formats, playoff identities map onto the existing FIRST match IDs. The mapper distinguishes full double-elimination brackets from Ontario championship parent finals. Other seasons/formats retain separate source identities. When FIRST metadata is unavailable, unverified playoff identities remain source-specific. Raw event facts preserve provider types and parent/division references; each parent/division remains a separate event scope. FIRST time strings remain local to the event timezone; TBA times use UTC ISO timestamps.

### Automatic schedule acquisition

Every added, non-archived provider-backed event in the configured organization is eligible from **6 p.m. on its first event day**, using its own timezone. The event does not need to be active or marked attending. The job attempts acquisition every ten minutes until both a complete, nonempty roster and a schedule with usable match participants are saved together. Empty, invalid, partial and failed responses do not stop polling. Events added after their start time are eligible on the next run. Attempts continue until acquisition or archival.

Automatic acquisition requests event metadata, the paginated event roster, and the schedule. FIRST is primary; a linked TBA event is the fallback when FIRST fails or has no schedule. Qualification schedules are preferred; finals-only championship parents can use playoff schedules. Results remain available through explicit reference imports.

Durable schedule and roster receipts stop all future automatic provider calls for that event, including after restarts. Existing schedule-only receipts are automatically backfilled through roster-only requests; saved match IDs and previous notifications remain unchanged. A later playoff schedule or rescheduling is **not** fetched automatically after this first save; use the explicit sync command when an update is needed. Explicit full imports set the corresponding receipts when they save complete rosters and usable schedules. Previously cached data without a receipt is verified once by the new job.

The saved roster, schedule, receipts and notification recipients commit together. Enrolled Telegram admins receive a private message after commit. Scouts and strategists do not receive it; admin membership is rechecked before delivery. Telegram rate limits/explicit server rejections are retried independently of schedule polling. Permanent rejections are recorded as failed. Timeout/interrupted delivery is recorded as uncertain for operator review instead of blindly sending a duplicate. `/event reference <event-id>` reports polling and notification state. This message is separate from future match briefing/coverage notifications.

### Railway schedule service

1. Apply all four reference/roster/schedule migrations through Production readiness. The workflow runs regression tests against disposable Postgres before production migration. Keep **Wait for CI** enabled for deployments.
2. Create a **separate Railway service** from the same repository/revision, retaining the repository workspace root. Use the normal dependency installation/build configuration.
3. Set its start command to `pnpm --filter @ai-scouting/backend schedule:sync` and its **Cron Schedule** to `*/10 * * * *`. Do not replace the Telegram backend's HTTP start command or configure an HTTP healthcheck for this run-and-exit service.
4. Set the cron service's `DATABASE_URL` to the same restricted runtime connection used by the backend, `TELEGRAM_ORGANIZATION_ID`, `TELEGRAM_BOT_TOKEN`, `FRC_EVENTS_USERNAME`, `FRC_EVENTS_AUTHORIZATION_KEY`, and optional `TBA_AUTH_KEY`. It does not need Mastra configuration, extraction enabled, or an admin user ID.
5. Deploy both backend and cron service after migrations, then inspect cron output and `/event reference <event-id>` on the dev bot before production rollout. Cron output reports attempt/save/notification counts. Add future events using `/event add <season> <code>`; selecting an active event is only needed for scouting intake.

The old `REFERENCE_SYNC_ENABLED` and `REFERENCE_SYNC_ADMIN_USER_ID` settings are no longer used. There is no sync timer in the web server. The cron command closes database connections and exits after one pass, including when no schedules are due; its job state survives between runs. Railway schedules are UTC, but the application evaluates each event's local 6 p.m. eligibility. Actual launch time can vary, so the first attempt is the cron run at or after that boundary. See [Railway cron jobs](https://docs.railway.com/cron-jobs).

## Participation validation (#3)

Apply `20261107220000_session_participation` through the migration pipeline. Deploy Mastra first: backend turns now send `deferFinalization: true`, keeping extraction resumable while the backend validates and finalizes. Existing suspended runs can resume; completed sessions remain complete. Then deploy the backend. No new credentials or polling service are required.

Admins configure an event with `/event validation <event-id> off|warn|strict`. New events default to warn; refresh preserves the mode. Changes apply to open sessions on their next processing turn, using their original event. `/event` shows the active event, validation mode, snapshot state/acquisition time, and the caller's five most recent open sessions with their event, match/team and validation status, even when scouting is paused. `/event reference <event-id>` retains detailed provider/import diagnostics.

Warn asks for clarification and offers “save unverified” once required fields are present. Strict blocks finalization until the exact match/team participates in the saved schedule; it always retains raw intake and replies. Off bypasses participation checks. A later note identifying the same event/match/scout/team as an earlier open session prompts “keep separate”; it is already saved independently. To append to the earlier session, explicitly reply to its latest question. Provisional notes, separate scouts and different scouted teams remain independent. Replies to completed sessions are rejected with instructions to use /flag.

Use Q42 for qualifications, P14 for FIRST playoff number 14, or an exact cached match key such as sf1m1. Bare numbers and round-only playoff labels are ambiguous. A missing match may require an explicit sync, especially for playoffs acquired after qualification schedules.

A saved schedule does not expire by age. Cached data without an acquisition receipt, or data with a later failed/partial import, is unverified/stale. Explicitly sync the affected provider to recover. Automatic acquisition remains permanently stopped after its first usable save; validation never re-enables it. Source freshness shown by reference diagnostics is distinct from schedule snapshot usability.

## Published specifications and corrections (#4)

Telegram remains the collection surface. Scouts request investigation without rewriting long dictated notes:

- `/flag 1241` flags your latest finalized submission for team 1241, across events.
- `/flag 1241 42 climb was incorrect` flags your submission for team 1241 in qualification match 42, with an optional note.
- `/flag 1241 Q42` specifies a qualification match; `P14` specifies a FIRST playoff match number.
- `/flag 1241 wrong robot` omits the match and attaches a note. Use `/flag 1241 -- 42 cycles was incorrect` when a note begins with a number. Notes may contain up to 2,000 characters.
- `/flags` lists the latest 20 requests submitted by enrolled teammates. `/flags <flag-id>` shows the reporter, event/match, note, targeted revision and whether it has been replaced, specification, validation outcome and a preview of the recorded data. Admins, strategists and scouts in the same organization can investigate; outsiders cannot view the requests.

`/flag` replaces scout-facing `/correct` and `/reextract`; both retired commands explain the flag interaction and create no extraction session. A flag records a concern and does not rewrite data, re-run extraction, change validation outcomes, or automatically disqualify coverage. The original raw notes, drafts and finalized records remain intact. Flag requests are immutable and retain the exact Telegram command, optional note, submitting member and selected revision. Requests remain attached to that revision if it is subsequently replaced. A future administration interface (#5) can consume the typed flag operations; resolution workflows and outbound team notifications are not part of this change. Team visibility currently uses the shared Telegram `/flags` list.

Only the submitting scout's current finalized revisions are candidates for their `/flag`. With no match, “latest” uses finalization time; it never selects another scout's submission or requires an active event. With an explicit match, multiple matching independent submissions/events are rejected as ambiguous; no active-event guess is made. Omit the match to select your latest submission for the team, or ask an admin to investigate a specific ambiguous submission. Successful Telegram delivery retries return the same saved flag and never re-resolve it against newer data.

A bare reply to a completed question is rejected with flag instructions and is never treated as a new submission. Re-extraction and replacement provenance remain internal backend capabilities for future authorized administration; scouts cannot invoke them through Telegram. No public administration flow for replacing observations is introduced here.

Warning acknowledgment remains explicit (`save unverified`); these revisions are marked `warning_acknowledged`. Off mode produces `unchecked`. Neither outcome counts as validated coverage.

Backend operations in `repositories/observations.ts` provide publication, selection and authorized history queries. `publishSpecification(org, telegramAdminId, season, kind, document)` publishes once; a reused version fails rather than changing content. `selectSpecification(org, telegramAdminId, eventId, version)` selects an existing match publication for new sessions. Use these typed operations from trusted operator tooling until #5 provides administration UI. Publications are tenant/season/kind scoped. Match publications require typed required match/team identity fields. The bundled game-neutral starter is bootstrapped for new event scopes; it is never substituted for an existing publication. Publish a new version for changes in meaning or fields. Pit/general publications may be stored, but their collection flows are future work.

Deploy order: apply forward migrations `20261107230000` and `20261108000000` with the migration role, deploy Mastra accepting the optional `specification` turn property, then deploy backend sending it. Old backends remain compatible during the Mastra-first transition. Rebuild both applications. Existing backend-assigned sessions read their original publication after deployment; changing the bundled template must not remove stored publications. Historical completed drafts are retained and are not automatically promoted to final records; their original validation/consent cannot safely be reconstructed. No roster/schedule polling changes are required.

Publication and revision tables reject updates/deletes and grant runtime SELECT/INSERT only. Raw notes remain the audit source; finalization commits its revision, validation, provenance and session completion atomically. Database uniqueness and transaction locks prevent duplicate finalization and revision forks. Telegram confirmations are enqueued atomically with finalization through the durable outbox described below; a delivery failure cannot erase a final record. Authorized history queries expose its UUID for operator recovery. Backend session completion remains authoritative while Mastra may remain suspended.

## Durable outbound delivery (#6)

Deploy migration `20261108010000_outbound` first, then deploy the backend and schedule cron together. Stop/drain old backend workers and schedule cron before migration/cutover: old binaries send outside the outbox and must not run beside new delivery workers. Mastra needs no change; retain #4's deployed specification-aware deferred-finalization endpoint. No deployment is performed by local verification.

Extraction commits its draft, validation, immutable final revision/session completion and outbound job together. Questions and completion confirmations have tenant/session/turn keys; schedule/roster receipt recipients have tenant/event keys. Unique recipient keys prevent duplicate jobs under replay/concurrency. Schedule receipts atomically insert into the outbox via a database trigger, including existing receipt entry points. Migration imports existing notification state; old sending/uncertain notifications become ambiguous. Previously completed extraction confirmations are not backfilled because their external delivery is unknown.

The backend drains delivery jobs every five seconds whenever both `TELEGRAM_ORGANIZATION_ID` and `TELEGRAM_BOT_TOKEN` are set, independently of extraction enablement. Schedule cron also drains the same queue. Delivery never invokes Mastra, finalization or provider acquisition. Membership is rechecked before each attempt, and schedule notifications require current admin status. A cancelled/ineligible or permanently unreachable recipient does not prevent other recipients from sending.

States: pending → sending → sent, pending (recoverable rejection), failed (permanent rejection), exhausted (six attempts per operator-approved budget), or ambiguous. Claims use row locks, SKIP LOCKED and UUID fencing tokens with a 60-second lease. Expired sending leases become ambiguous; they are never automatically resent. Explicit Telegram 429/5xx rejections retry with exponential delay from 60 seconds up to one hour; a longer Telegram retry_after takes precedence and pauses further tenant claims until due. Already in-flight requests can finish. A configured bot belongs to one organization; sharing the same bot between independently configured tenants is unsupported for rate-limit coordination.

Timeouts, malformed responses, transport errors and success followed by a failed persistence commit may mean Telegram accepted the message. These remain ambiguous. There is no exactly-once external delivery guarantee. Jobs and counts are durable; no secrets, remote descriptions or raw exception strings are saved in delivery errors. A question includes an opaque delivery reference. A direct Telegram reply carries that reference back, allowing tenant/recipient-checked session routing even if acceptance/message-ID persistence failed. Successfully recorded question IDs also remain queryable across subsequent turns. Session, scout, event and assigned publication stay pinned, including after active-event changes. Raw notes and immutable revisions are independent of delivery outcomes.

Use trusted host access with the restricted backend database credentials (never expose this CLI as a public identity-authenticated API). From `apps/backend`:

```sh
node --env-file=.env src/delivery-admin.ts list <organization-id> <telegram-admin-id>
node --env-file=.env src/delivery-admin.ts retry <organization-id> <telegram-admin-id> <delivery-id> 'Reviewed failure and repaired recipient'
node --env-file=.env src/delivery-admin.ts retry <organization-id> <telegram-admin-id> <delivery-id> 'Verified with recipient; accept possible duplicate' accept-duplicate-risk
```

The caller must be a current tenant admin. List returns 100 rows; pass an optional numeric offset after the admin ID to inspect subsequent pages. Inspect status/error, recipient, session/event, attempt count, timestamps and message ID; verify recipient eligibility and Telegram chat history before retrying. Ambiguous retry requires the literal duplicate-risk acknowledgment. Retry grants six additional attempts without resetting lifetime attempt count, never creates a new job, and records actor, reason, prior status and risk acceptance in append-only runtime intervention history. Do not put secrets in reasons. Do not manually resume completed Mastra runs or re-submit scouting data to recover a notification.

For #10, `created_at`/`next_attempt_at` measure queue age/due lag; `attempted_at`, `lease_expires_at`, `updated_at`, `sent_at`, attempts and intervention timestamps measure claim, interruption and recovery latency. These are wall-clock database/worker timestamps, not proof the recipient read a message. Hosting/event-mode, cost analysis and backup/restore remain #10 work.

Webhook-response inventory: intake accepted/rejected/enrollment acknowledgments, `/scout` syntax errors and every command response (including `/start`, invitations, events, `/flag`, `/flags` and retired-command guidance) remain synchronous Telegram webhook responses. Telegram provides no send result/message ID for these responses. They are best effort, outside the durable outbox, and may be lost or repeated independently of committed command/intake state; duplicate intake intentionally returns no second acknowledgment. The asynchronous follow-up questions, saved confirmations and schedule/roster receipt notifications use the durable outbox. No scout-facing `/correct` or `/reextract` is restored.


## Event-day controls and recovery (#10)

Use [event-day reliability](event-day-reliability.md) for EVENT_MODE, the independent bounded recovery cron, authorized queue-health snapshots, restore quarantine and production release gates. Existing installations retain continuous mode unless explicitly configured. No new database migration or Mastra contract is introduced; #6 must already be deployed. Configure HTTP and cron overrides together. Simulation/restore evidence is disposable and does not establish production uptime, billing or RTO/RPO.

## Privacy release gate

Follow [Privacy boundaries](privacy.md) before enabling web enrollment or data exports. Publish the [notice](privacy-notice.md) with the responsible adult lead’s contact, and verify retention and vendor settings. Trace exports use a strict content-free allowlist; retain them for at most 30 days and restrict access. Workflow snapshots remain private content-bearing operational records.

### Shared Telegram bot

Apply migration `20261109040000_telegram_connect` using the migration owner
(which must have BYPASSRLS, as for operator provisioning), then deploy the backend.
Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and
`TELEGRAM_BOT_USERNAME` (the bot username without `@`). The username is needed
for web connection links. `TELEGRAM_ORGANIZATION_ID` is no longer used for routing
or workers; existing enrolled identities and invitation links continue working.
The ID-only `scouting_organization_ids()` function discovers worker tenants;
all organization data queries still run in transaction-local tenant RLS.

Approved web admins connect from their team workspace, follow the link, and
confirm it in the shared bot. Links expire after ten minutes and can be used once.
Creating another link invalidates earlier unused links for that admin. The bot
links the existing admin member; it refuses to replace a conflicting Telegram
identity. Disconnect on the team page before reconnecting. Used token hashes,
Telegram IDs and use timestamps are retained for auditing.

Admins create reusable scout links with `/invite` in Telegram and revoke them
with `/revokeinvite`. A person enrolled on several teams uses `/team` to show
a button for each accessible team; tapping a button selects the active team. Membership is checked on every
message; no message is submitted until an ambiguous team choice is resolved.
Extraction, outbound processing, recovery and schedule jobs discover all teams.
One team's failure is recorded in the durable queue for recovery.

Telegram team-selection buttons require the webhook to include both `message`
and `callback_query` in `allowed_updates`. Re-register an existing webhook with
`telegram-setup.ts webhook <https-base-url>` after deploying this change; the
setup command includes both update types. Button taps recheck current membership.
