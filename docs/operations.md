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
6. Verify one complete submission/follow-up and its Studio trace. Retain historical eventless records without assigning them automatically.

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

Warn asks for clarification and offers “save unverified” once required fields are present. Strict blocks finalization until the exact match/team participates in the saved schedule; it always retains raw intake and replies. Off bypasses participation checks. A later note identifying the same event/match/scout/team as an earlier open session prompts “keep separate”; it is already saved independently. To append to the earlier session, explicitly reply to its latest question. Provisional notes, separate scouts and different scouted teams remain independent. Replies to completed sessions are rejected with a correction-not-supported response (#4).

Use Q42 for qualifications, P14 for FIRST playoff number 14, or an exact cached match key such as sf1m1. Bare numbers and round-only playoff labels are ambiguous. A missing match may require an explicit sync, especially for playoffs acquired after qualification schedules.

A saved schedule does not expire by age. Cached data without an acquisition receipt, or data with a later failed/partial import, is unverified/stale. Explicitly sync the affected provider to recover. Automatic acquisition remains permanently stopped after its first usable save; validation never re-enables it. Source freshness shown by reference diagnostics is distinct from schedule snapshot usability.
