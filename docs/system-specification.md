# AI Scouting system specification

Version: 1.0 • Updated: 2026-11-07 • Owner: Team 1241

This document consolidates the product decisions, implementation progress, architecture, deployment history, and future direction discussed during initial development. It is the current planning reference. “Implemented” describes repository code and previously verified deployments, not a fresh live-service audit. “Planned” records agreed direction; “proposed” identifies recommendations still open to change.

This is the authoritative product and architecture reference. Use [development](development.md) for local setup, migrations, tests, and build compatibility, and [operations](operations.md) for hosted configuration, releases, and invitation commands. GitHub issues/project track implementation status and dependencies; this document records intended behavior. Earlier design documents have been consolidated here; their history remains in Git.

## 1. Purpose and scope

Collect useful scouting information from students with minimal friction, preserve their original messages, extract consistent structured data, and eventually support team and match strategy. Initially serve Team 1241 at Canadian competitions, offseason events, and the World Championship. Keep a path to multiple organizations without building a public SaaS product prematurely.

Scouts use their phones to send typed or keyboard-dictated Telegram notes. Venue connectivity may be poor. Messages must identify their match explicitly; arrival time is not a reliable indication of the match observed. Telegram provides transport and queued sending, but the system is not an offline scouting database: server processing and replies require connectivity.

The original operating target is approximately USD $20/month. Free tiers are acceptable during development and interim production, including cold starts. That target is a budget goal rather than a guaranteed bill or event-day availability commitment.

## 2. Roles and user experience

| Role       | Intended responsibilities                                               |
| ---------- | ----------------------------------------------------------------------- |
| Scout      | Submit notes and answer follow-up questions                             |
| Strategist | Review observations, compare teams, and ask match-preparation questions |
| Admin      | Manage membership, invitations, events, specifications, and operations  |

The initial bot processes private chats. Group/channel intake is not implemented. Telegram enrollment creates a member with the scout role; strategist/admin promotion requires a separate administrative path.

### Implemented intake flow

1. Verify the Telegram webhook secret and validate the incoming payload.
2. Resolve the configured organization and enrolled Telegram identity.
3. Persist the original text and delivery identifier before AI processing. Duplicate deliveries do not create duplicate entries.
4. Acknowledge: “Received your scouting note. Processing it now…”
5. The backend worker claims the entry and calls the hosted Mastra extraction workflow.
6. Validate the structured result and determine missing fields in application code.
7. For a complete result, save the draft extraction and reply: “Your scouting data has been saved. Thanks!”
8. For an incomplete result, ask for missing match/team details in a separate message first, only when those details are missing. Ask remaining specification questions afterward.
9. Link the scout's ForceReply answer to the original entry and reprocess the original plus its replies.

“Saved” currently means the raw note and extraction JSON are persisted. A separate confirmed observation model is still planned. One note currently describes one team in one match; multiple observations in one message are outside the initial contract.

### Implemented enrollment

Admins can create, list, and revoke reusable Telegram invitations. Joining enrolls a scout, is idempotent, and preserves existing roles. See [operations](operations.md#invitations-and-membership) for commands and link handling.

## 3. Current implementation status

| Capability                                                           | Status                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Hono backend and Mastra app in a pnpm monorepo                       | Implemented                                                              |
| Neon intake tables, tenant isolation, repositories, migrations/types | Implemented                                                              |
| Telegram webhook, enrollment checks, deduplication                   | Implemented and previously tested locally/hosted                         |
| Reusable admin invitation commands                                   | Implemented; production command routing previously verified              |
| Specification-driven Anthropic extraction and linked follow-ups      | Implemented with starter specification                                   |
| Separate development bot and Neon branch                             | Configured                                                               |
| Mastra Platform deployment and restricted backend credential         | Configured and previously smoke-tested                                   |
| Railway production backend                                           | Deployed                                                                 |
| GitHub production readiness and migration workflow                   | Implemented; user confirmed successful run                               |
| Automatic Render deployment after readiness                          | Configured, but one successful run did not trigger rollout; unresolved   |
| API-backed event configuration and session context                   | Implemented for issue #1                                                 |
| Reference imports and schedule validation                            | Implemented reference acquisition (#2) and participation validation (#3) |
| Final observations, corrections, review queue                        | Planned; not implemented                                                 |
| Admin web app and web authentication                                 | Proposed; not implemented                                                |
| Strategist agent, statistics, summaries                              | Planned; not implemented                                                 |
| Automatic/manual event mode                                          | Planned; not implemented                                                 |

## 4. Architecture and ownership

```mermaid
flowchart TD
  Scout[Scout: Telegram private chat] --> Telegram[Telegram Bot API]
  Telegram -->|HTTPS webhook| Backend[Hono backend: Railway]
  Backend -->|Tenant repositories| Public[(Neon: scouting tables)]
  Backend -->|Authenticated workflow request| Mastra[Mastra Platform]
  Mastra --> Anthropic[Anthropic API]
  Mastra --> Storage[(Neon: dedicated mastra schema)]
  Mastra -->|Validated extraction result| Backend
  Backend -->|Questions and confirmations| Telegram
  Admin[Future admin web app] -.->|Authenticated data API| Backend
  FIRST[FRC Events API: primary] -.-> Sync[Future reference-data sync]
  TBA[TBA: supplemental coverage] -.-> Sync
  Sync -.-> Backend
```

Solid connections represent existing integration; dashed connections represent planned work. Both Neon nodes are logical boundaries within the same database environment, not separate copied databases.

| Component           | Choice and responsibility                     | Reason / tradeoff                                                                                                                                                              |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scout channel       | Telegram                                      | Low setup effort; uses existing phones and supports typed/dictated input. Depends on Telegram accounts and venue connectivity.                                                 |
| Application backend | Node 24 + Hono on Railway                     | Owns intake, access control, scouting persistence, retries, and future reference sync/data API. Free hosting was accepted while Railway signup was unavailable.                |
| Agent runtime       | Managed Mastra Platform                       | Hosts extraction agents/workflows and Studio; avoids operating the agent server ourselves. Adds an HTTP/authentication boundary and platform usage charges.                    |
| Database            | Neon Postgres                                 | One transactional source for scouting data with separate dev/production branches and scale-to-zero capability.                                                                 |
| Agent storage       | Dedicated `mastra` schema in Neon             | Reuses database infrastructure while isolating agent tables and permissions. A shared compute budget and failure domain remain.                                                |
| Database access     | Kysely + pg, centralized backend repositories | Typed queries, explicit migrations, and one place for tenant/transaction rules. No route-level SQL or model-generated SQL.                                                     |
| Shared contracts    | `packages/scouting` + Zod                     | Specification, structured output, and deterministic completeness rules shared across applications.                                                                             |
| Formatting/lint     | Biome                                         | Shared workspace configuration and checks.                                                                                                                                     |
| Extraction provider | Direct Anthropic API key; Haiku 5.5           | Inexpensive extraction model. Quality must be measured on real scouting notes.                                                                                                 |
| Admin interface     | Small dedicated web app, proposed             | Suitable for event lists, specifications, review, and settings; Telegram retains scout intake and quick commands. Framework, hosting, and web identity provider are undecided. |

### Alternatives and rationale

Telegram was selected over building a native application initially to reduce delivery effort and avoid relying on a local phone number at Worlds. SMS adds carrier registration and delivery costs; alternative chat channels add onboarding/integration work. Native offline storage remains an option if venue testing reveals a concrete gap. Check school messaging policy before student rollout.

The original single self-hosted Mastra/Railway design was superseded by a backend plus managed agent runtime. Railway signup was unavailable during setup; Render was accepted as an interim host, including free-tier sleep. Fly.io was considered but not selected. Moving hosts is optional rather than a requirement to complete the product. Neon was retained over introducing Turso because a dedicated schema meets current agent storage needs without another database provider.

Correctness depends on explicit match context and linked replies, rather than ordered context commands or receive-time inference. Scout assignments (such as Red 2) could help resolve teams later, but are not currently a substitute for explicit, validated team identity.

### Repository layout

- `apps/backend`: webhook, commands, repositories, worker, migrations, generated database types, future APIs/sync.
- `apps/mastra`: agents, workflows, platform configuration, and agent storage adapter.
- `packages/scouting`: versioned requirements and shared runtime contracts.
- `docs`: system specification, operating guides, and historical decisions.
- `.agents/skills`: shared Neon and Mastra development skills; `.claude/skills` links to these copies. Skills are repository tooling, not separate application packages or duplicated per app.

Backend code stays centralized in its repositories until another consumer creates a concrete need for a shared backend package. Mastra returns results; the backend owns all scouting-table writes.

## 5. Persistence and security

### Existing data

`organization`, `member`, `channel_identity`, `raw_entry`, `invitation`, and `scouting_session` exist. The event implementation adds tenant-owned `event`, `organization_event_setting`, an `event_command` replay ledger, and an `intake_rejection` receipt table. Raw entries retain original text, receipt metadata, processing state, retry/lease information, parent linkage, and extraction JSON. Tenant-scoped delivery identifiers prevent duplicate intake.

Every tenant operation sets transaction-local `app.organization_id` on the same connection used by its queries. Forced row-level security and composite foreign keys protect organization boundaries. Runtime users must not have owner privileges or RLS bypass.

Production backend uses a restricted pooled connection. Migrations use a separate administrative unpooled connection. Mastra has a dedicated login restricted to its schema; development uses a separate login and development branch. Shared storage does not mean sharing an unrestricted database credential.

### Planned domain data

Add provider imports/caches, event teams, matches/participants, published specification versions, and final observations. Final observations should reference their source raw entries, event, match, team, author, and specification version. Corrections should retain history and identify the observation they replace.

Public reference facts can be shared; attendance, active-event selection, specifications, scouting observations, and manual organizational overrides must retain clear tenant ownership. The exact shared-reference schema is still a design decision.

Secrets remain in ignored local environment files or provider/GitHub secret stores. Never embed credentials in this document or source control. Hosted backend-to-Mastra calls use HTTPS and a dedicated service token restricted to the extraction workflow endpoint; Studio uses platform authentication.

### Durable scouting sessions

Each initial scouting submission creates a tenant/member-owned `scouting_session` in the intake transaction, using its root raw-entry ID as the stable Mastra run ID. It snapshots the active event and supported specification. New submissions require a valid active event; otherwise no note/session is created, and the scout must resend after event selection. Only rejected-delivery metadata is retained to prevent retries adopting a later event. Linked Telegram answers resume that run rather than starting another extraction workflow. The run suspends with the current requirements result. Backend requests defer workflow finalization so schedule clarification can resume the same run even after extraction has all required fields; the backend owns session completion. The backend stores match/team identity as it becomes available and tracks completion separately from immutable raw messages.

A session's turn ID is a hash of its original note and ordered replies. Replaying a persisted turn returns the cached result; concurrent identical requests in one Mastra process share execution. Provider errors suspend without a result so retry can resume the same run. A crashed execution left in a running/failed state needs operator recovery rather than silently starting another run. Snapshot storage must be configured. The backend rejects replies to completed sessions; completed-session corrections remain deferred to #4. Legacy workflow clients without deferred finalization still complete their run and reject new turns.

Sessions pin the current specification version. Processing refuses a version mismatch rather than silently changing an open session's requirements. Full multi-version schema support remains planned. Event context is pinned at intake. The session boundary is one initial submission and its explicitly linked replies. Provisional submissions remain independent. Once event/match/scout/team resolve, a newer note targeting an earlier open session requires an explicit “keep separate” reply; notes are never silently merged. Separate scouts and different scouted teams remain independent.

The session endpoint is `POST /scouting/sessions/:runId/turn`, authenticated with the backend service token. The stateless extraction workflow has been removed; the worker uses sessions exclusively. Run the database migration, deploy Mastra with the new endpoint, then deploy the backend. Do not switch the worker before the endpoint is available. Telegram outbound delivery still has the documented non-atomic send/commit limitation.

## 6. Extraction requirements

The current JSON requirements document is a starter template, not an official 2026 or 2027 game specification. It requires a match label, positive team number, and explicit climb outcome; free-text notes are optional. Supported field types are text, positive integer, and boolean.

Requirements determine field descriptions, required fields, and follow-up wording. Missing/ambiguous values become null; explicit false is valid data. Application code computes completeness instead of trusting an agent's assertion. Scout input is untrusted data and cannot override the specification.

Future specifications should be published immutable versions associated with season and observation kind (`match`, `pit`, `general`). Each note should retain its assigned specification version across follow-ups and deployments. Re-extraction under another version must be explicit. The current session rejects changes to its pinned version; loading multiple published schemas remains planned. Define the actual 2027 requirements after Kickoff.

## 7. Event configuration and external data

API-backed event configuration, active-event selection, intake-time session binding and explicit delayed-note event selection are implemented for issue #1. FIRST event-detail lookup and selection by season/code are implemented. Roster/schedule imports, per-source caches, TBA supplementation, sync status and one-time scheduled acquisition with admin Telegram notifications are implemented for issue #2; paired regular-season, Ontario championship and Worlds fixtures and live checks cover verified 2026 playoff formats. Event-scoped match/team validation and Telegram context are implemented for #3. Command syntax and setup live in the [operations guide](operations.md#events).

### Source policy

Use the **FRC Events API as the primary source**, with **The Blue Alliance for supplemental coverage**, including offseason uploads. Event metadata is created and refreshed only through a provider API; manual JSON creation/editing is not supported. TBA imports official FIRST data, so it is not independent redundancy for a FIRST upstream outage. TBA's Trusted API also accepts directly supplied event data.

Sources: [FIRST API documentation](https://frc-api-docs.firstinspires.org/), [TBA source repository](https://github.com/the-blue-alliance/the-blue-alliance), [TBA developer APIs](https://www.thebluealliance.com/apidocs).

Use internal event/match IDs with optional source identifiers. Do not assume provider event codes match. Resolve corresponding event links automatically from provider-declared FIRST identifiers and a unique compatible match, with manual linking available when resolution fails. Track provenance, last successful synchronization, errors, and organization settings. Provider refreshes update provider facts while preserving organization settings and stable session links; missing primary fields can be supplemented. Provider adapters should normalize data before repository persistence.

### First event settings

| Setting                   | Requirement                                                       |
| ------------------------- | ----------------------------------------------------------------- |
| Name and season           | Any supported year, including historical/offseason testing        |
| Source identifiers        | FRC Events identifiers; TBA identifiers when its adapter is added |
| Event type                | Official, offseason, practice                                     |
| Dates/timezone            | Local event context and schedule rendering                        |
| Attendance                | Whether 1241 attends; scouting another event remains possible     |
| Specification version     | Explicit published requirements for extraction                    |
| Validation mode           | Off, warn, strict; initially warn                                 |
| Archive state             | Preserve history and remove old events from ordinary selection    |
| Organization active event | One active scouting event for 1241 initially                      |

Active event is an organization setting. Attach it when a note is received and preserve it across event switches and follow-ups. Do not infer event/match from webhook arrival time, especially after offline queuing. Delayed notes can explicitly select an event using the documented scout command; an active event is still required. Existing sessions retain their original event for follow-ups even if scouting is paused. Eventless historical sessions are preserved without automatic reassignment; their incomplete notes must be resubmitted.

Automatic schedule acquisition runs in a separate ten-minute cron job for every added, non-archived provider-backed event, beginning at 6 p.m. event-local time on its first day. It stops permanently for that event after saving the first usable schedule and complete team roster and queues a private confirmation for enrolled Telegram admins. Qualification schedules are preferred; finals-only parents use playoff schedules. Existing schedule-only imports receive a one-time roster backfill without re-fetching matches or re-notifying admins. Later playoffs, rescheduling, roster refresh and results require an explicit import. Failed/empty/partial responses keep polling; notification delivery state is independent of acquisition. The HTTP backend has no polling timer.

Cache teams and schedules locally, including qualification and full playoff round/set/match identity. Validate that a team participates in a referenced match. Missing schedules must allow intake when an event is active; warn mode flags inconsistencies for clarification/review. Strict mode must preserve the raw note even when it prevents finalization. Failed syncs retain the last usable schedule. Historical matches and existing observation links must survive schedule updates.

### Participation validation (#3)

The backend resolves explicit match labels within the session's original event against stable stored match IDs and participant records. All six alliance stations, including surrogate participants, are eligible. FIRST participant records take precedence over TBA on linked matches. Existing manual time overrides do not change participation. Missing or malformed participant sets are unverified. Qualification labels accept Q42, QM42 or qualification match 42. FIRST playoffs accept P14 or first:playoff:14; TBA round/set/match keys such as sf1m1 and full event-prefixed keys are supported through stored aliases. Bare numbers, round-only playoff labels and aliases identifying multiple stored matches require clarification. Arrival time and team membership never disambiguate a match.

Events default to warn. Off bypasses participation checks. Warn asks for corrected details and permits the scout to reply “save unverified” to finalize with the persisted warning once required extraction fields are complete. Strict requires successful participation validation before finalization and cannot be bypassed by that reply. Raw notes and each linked answer are committed before either extraction or validation, including missing schedules, invalid pairs and strict failures. A warning acknowledgment applies to the same extracted match/team; a changed identity requires another decision.

A durably acquired schedule is a snapshot, not a continuously refreshed feed: age alone never makes it stale. Cached matches without an acquisition receipt are unverified/stale; a later failed or partial explicit reference import marks the snapshot uncertain until that source has a successful complete import. Missing match participants or a playoff absent from the snapshot require explicit admin sync. This never restarts automatic polling after the first usable schedule receipt. Reference-source freshness remains separate diagnostic information; schedule validation uses this snapshot policy.

Resolved sessions persist match ID, extracted team number and validation details. A composite foreign key prevents linking to a match from another event or tenant. New submissions never inherit another session's identity. Additional notes resolving to an existing earlier open session remain independent and ask for “keep separate”; to append to the earlier session the scout must explicitly reply to that session's latest question. Replies preserve the session event even if the active event changes, is cleared or is archived. Completed-session corrections are outside this feature.

### First event acceptance checks

Use a 2026 offseason event with a published schedule. Verify provider normalization, valid and invalid match/team pairs, playoff references, missing schedules, repeated imports, source conflicts, preservation of organization settings, and event switching during an unfinished follow-up. Use recorded fixtures for repeatable tests and a separate live import smoke test when credentials are available.

## 8. Reliability and event-day operations

Implemented worker: five-second polling while enabled, one claimed entry at a time, up to three attempts with a one-minute retry delay, and five-minute stale-processing recovery. Durable raw entries protect against agent failure. Exhausted retries currently require manual intervention.

Telegram sends and database commits are not atomic. A crash can repeat a question or leave a confirmation undelivered. Add a durable outbound-message queue/outbox with delivery tracking, retry visibility, and an explicit policy for ambiguous sends. Do not promise exactly-once delivery to Telegram.

Render Free sleeps after 15 minutes without inbound traffic; outbound worker queries do not prevent that. Once asleep, the in-process worker cannot make progress until the service wakes. Neon polling can nevertheless keep database compute awake while the backend runs. The earlier Railway-specific event-mode design does not apply unchanged.

Planned event mode: `auto`, `on`, `off`, timezone-aware event windows, explicit manual override, and a deployment-compatible wake/recovery plan. For reliable live events, assess paid always-on backend hosting rather than depending on an in-process timer to wake a sleeping service. Background polling should reduce/stop during idle periods without losing eventual retry recovery.

Operational views should expose queue age, failed entries, exhausted attempts, outbound failures, sync freshness, and recent processing/model costs. Add restore/backups verification, structured redacted logs, and alerts appropriate to the budget.

## 9. Environments and deployment

| Environment | Bot                     | Database                                      | Agent runtime                                            |
| ----------- | ----------------------- | --------------------------------------------- | -------------------------------------------------------- |
| Development | Separate dev bot        | Neon development branch                       | Local Mastra; optional separate hosted dev project later |
| Production  | `@theory6_scouting_bot` | Neon production branch, restricted app logins | Mastra Platform production project                       |

Production backend: <https://ai-scoutingbackend-production.up.railway.app>. Render was the previous host. Mastra project: <https://projects.mastra.ai/team-1241/ai-scouting>. Local testing uses a tunnel for Telegram webhooks; restarting local processes/tunnels may require webhook registration again.

Releases apply reviewed migrations through GitHub Actions before backend rollout, using separate migration/runtime credentials. Mastra has a separate deployment path. Automatic Render deployment is configured but still needs verification after a successful-check/no-rollout incident. See [operations](operations.md#release-workflow) for the procedure and [development](development.md#mastra-build-compatibility) for the existing pnpm compatibility patch.

Repository work uses GitHub issue prefixes as defined in [AGENTS.md](../AGENTS.md).

## 10. Costs and budget

All amounts below are **USD**, excluding tax, exchange rates, domain registration, and developer subscriptions. Public prices checked 2026-11-02; these are planning inputs, not account invoices. Confirm actual subscribed plans and usage in the consoles before changing infrastructure.

| Item                            | Current approach and published cost                                                                                            | Budget implication                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Render backend                  | Free $0; published smallest paid compute approximately $7/month                                                                | Free cold starts accepted for now; paid hosting is the first reliability upgrade             |
| Neon                            | Free: 100 CU-hours/project/month, 1 GB storage; Launch compute $0.106/CU-hour and storage $0.35/GB-month                       | Development and production usage both matter; schemas do not create separate free allowances |
| Mastra Platform                 | Starter $0 base; 24 CPU-hours included, then $0.35/hour; 100K observability events, then $10/100K; 10 GB egress, then $0.10/GB | Free base does not mean unlimited free usage                                                 |
| Mastra persistent server option | $100/project                                                                                                                   | Outside the original $20 target; not selected                                                |
| Anthropic                       | Direct API usage, separate from hosting                                                                                        | Varies with note volume, follow-ups, prompt size, reasoning, and retries                     |
| Admin web app                   | Hosting/auth not selected                                                                                                      | Static hosting may avoid another server; SSR or separate paid services add costs             |
| Telegram                        | Standard bot messaging has no per-message charge in this design                                                                | No SMS spend in the initial system                                                           |
| CI and event data APIs          | No paid plan selected                                                                                                          | Verify private-repo CI allowances and provider terms/rate limits; not priced as unlimited    |

Sources: [Render Free behavior](https://render.com/docs/free), [Render published compute comparison](https://render.com/articles/render-vs-railway), [Neon pricing](https://neon.com/pricing), [Mastra pricing](https://mastra.ai/pricing). Neon bills our external database; Mastra-hosted database pricing is not the database choice here. Direct Anthropic keys are used; the optional Mastra gateway's markup is not assumed.

### Illustrative model budget

Published Haiku 5.5 rates for prompts up to 100K tokens: $0.10/million input and $0.50/million output. Sonnet 5.5: $2/million input and $10/million output. [Anthropic model comparison/pricing](https://platform.claude.com/docs/en/models/haiku-5-5/overview).

| Workload                      | Assumption                                 | Estimated API cost |
| ----------------------------- | ------------------------------------------ | ------------------ |
| One extraction attempt        | 2,000 input + 500 output tokens            | $0.00045           |
| 2,000 extraction attempts     | Same token sizes; no caching discount      | $0.90              |
| 100 future strategy questions | 20,000 input + 2,000 output each on Sonnet | $6.00              |

These are arithmetic examples, not measured production averages. Follow-ups and retries add attempts. Context growth, thinking tokens, model changes, and larger outputs can materially change cost. Prompt caching is a proposed optimization, not an assumed discount in these estimates. The strategist workload is not implemented.

### Monthly planning scenarios

- **Quiet development:** $0 hosting base within allowances, plus actual model calls. This requires managing idle database polling.
- **One event, free hosting:** approximately $0.90 extraction-only model example; approximately $6.90 with the future strategy example, plus any platform/database overages. Cold-start limitations remain.
- **One event, paid backend:** approximately $7.90 extraction-only or $13.90 with the strategy example, before Neon/Mastra overages and other costs.

These scenarios are estimates, not fixed-price packages. Paid Neon can push the last scenario over $20: an always-awake 0.25-CU compute for a 30-day month alone is 180 CU-hours, or about $19.08 at the Launch compute rate, before storage and other usage. On Free, the same workload exceeds the quoted 100-CU-hour allowance. A 48-hour event at 0.25 CU is 12 CU-hours. Actual compute size, active periods, and multiple branch computes determine consumption.

Cost controls: measure tokens per attempt and per completed note; monitor dev/prod database compute; limit idle polling; sync reference data conditionally; avoid sending full event histories to every prompt; configure provider spend controls/alerts where available; retain only needed traces; review usage after the first event. No cost ceiling should be claimed solely from these estimates.

## 11. Automatic match notifications

These are requested future features, not implemented. Both use Telegram private messages to configured recipient groups selected by role. Recipient configuration must be tenant-scoped; selecting an eligible role should not require maintaining a separate list for every match. The existing `strategist` role is the initial briefing audience. Coverage alerts may target the same role or a separate configured audience. Whether to introduce a dedicated scouting-coordinator role remains open.

### Upcoming-match briefing

Automatically send strategy recipients a briefing for each upcoming match involving Team 1241. Include all teams on both alliances, including 1241, with alliance/position, relevant scouting summaries, strengths, weaknesses, recent performance, and gaps or conflicting evidence. Clearly distinguish our observations from official results and derived statistics. Missing scouting data must be visible rather than replaced with invented conclusions. Link or identify the event and full match identity.

The backend determines the match and recipients from stored schedule/configuration. Typed query tools supply the evidence; an agent may summarize it. Generate one briefing per match/evidence version and fan it out to recipients rather than generating separately for each user. Persist the evidence cutoff and generation time so strategists know how current it is.

Proposed initial settings: enable/disable per event, recipient role, and a configurable lead measured in matches before 1241 plays. Match progression is preferable to scheduled wall-clock time alone because events run early or late. Exact lead, fallback when progression is unavailable, and briefing refresh policy require confirmation. Only current-event progression should trigger live messages; importing historical results must not send an event's entire briefing backlog.

Acceptance: only 1241 matches trigger briefings; all scheduled teams appear; only eligible configured recipients receive them; absent evidence is labeled; retries/restarts do not intentionally resend an already delivered briefing. Schedule changes cancel obsolete queued briefings and preserve the delivery audit.

### Qualification scouting-coverage alert

After each qualification match at the active event, check coverage for every participating team, including matches without 1241. Send configured recipients a message listing the teams without a qualifying scouting observation for that exact event/match/team combination. If every team is accounted for, send no message. Limit this feature to qualification matches initially.

Proposed initial definition of accounted for: at least one finalized, valid match observation, regardless of scout. Multiple observations of the same team count once. Raw notes awaiting extraction, incomplete drafts, failed entries, and observations for another match do not count as complete coverage. The alert should distinguish pending/incomplete submissions from no submission where possible. This definition should be confirmed before implementation.

Use published match results/completion as the normal trigger, followed by a configurable grace period to allow scouts to submit notes and extraction to finish. Scheduled start time alone is not evidence that a match ended. During missing or stale external updates, defer the check and expose the stale state. Exact grace period and any manual completion override remain open.

Recompute coverage immediately before sending. Record the match, checked teams, missing teams, cutoff, recipients, and per-recipient delivery state. If late data completes coverage before dispatch, suppress the alert. Proposed default is one alert per match per recipient; late data updates the coverage view without repeatedly sending messages. Reminder/resolution messages are optional future behavior, not part of the request.

Acceptance: full coverage produces zero outbound messages; partial coverage lists exactly the missing teams; duplicate observations do not hide gaps; delayed extraction respects the grace period; playoff matches do not trigger this alert; historical imports do not create an alert backlog.

### Shared delivery and operational requirements

Use the planned durable outbound-message queue, with unique logical notification keys and per-recipient state. Repeated schedule/result syncs, overlapping workers, and restarts must not create duplicate notification jobs. Telegram delivery can still be ambiguous after a network failure; retain that state for reconciliation rather than claiming exactly-once external delivery.

Recheck event enablement, membership, recipient role, and bot reachability before dispatch. Recipients must enroll and start the bot before private delivery works. One unreachable user must not block other recipients. Record failures and allow controlled retry. Provide an event-level pause and a preview/test path before enabling live automation.

Coverage checks and missing-team messages should be deterministic and require no model call. Briefing generation adds model usage, while progression polling and evidence queries add database/API usage. Budget by briefing count, prompt size, refresh count, and recipients; recipient fan-out increases Telegram deliveries without multiplying model generation. These costs are additional to the illustrative strategy-question workload above.

## 12. Roadmap and future features

| Priority                   | Deliverable                                                                                        | Completion outcome                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Next                       | Event model, active-event settings, provider adapters and schedule validation                      | A note retains event context and validates match/team against imported data                       |
| Next                       | Final observations and versioned specifications                                                    | Complete drafts become queryable domain records; corrections preserve history                     |
| Next                       | Minimal authenticated admin web app                                                                | Events, specification selection, review queue, members/invitations, operational status            |
| Before live event reliance | Retry administration, outbound delivery tracking, event-day hosting decision, rollout verification | Failures are visible/recoverable and deployment behavior is proven                                |
| Then                       | Deterministic team statistics and strategist agent                                                 | Answers use typed query tools and cite source observations; no arbitrary model SQL                |
| Then                       | Automatic upcoming-match briefings                                                                 | Role-selected recipients receive evidence-based summaries of every team in 1241’s upcoming match  |
| Then                       | Automatic qualification coverage alerts                                                            | Configured recipients hear only about matches with missing team observations after a grace period |
| Then                       | Strategy and coverage dashboard                                                                    | Strategists can compare teams, inspect conflicts, and see missing coverage                        |
| Later                      | Pit/general observations, scout assignments and coverage tracking                                  | Collection expands beyond one match-note template                                                 |
| Later                      | Batched follow-up questions                                                                        | Reconnected scouts avoid a flood of separate questions                                            |
| Later                      | Optional Discord summary delivery                                                                  | Authorized strategy-channel output; not another intake dependency                                 |
| Later                      | Multi-organization onboarding and explicit sharing grants                                          | Teams remain isolated unless owners grant access                                                  |
| Conditional                | Native/offline app, SMS, media/voice attachments                                                   | Add only after real venue tests show Telegram gaps; price and design separately                   |

A web app is the recommended administration surface because schedules, configuration, review tables, and historical edits benefit from visible state. Telegram remains the primary scout workflow and may expose `/event` and limited admin shortcuts. Web login must map to existing membership and enforce roles on the backend; provider choice remains open.

## 13. Outstanding decisions and validation

- Confirm notification recipient roles, briefing lead/refresh policy, coverage completeness definition, and post-match grace period.
- Select the first 2026 offseason test event and obtain FRC Events/TBA credentials through secure configuration.
- Define the actual historical-season test specification; current climb template is insufficient for game-specific scouting.
- Set policy for delayed notes, explicit event overrides, multiple concurrent events, and ambiguous match labels.
- Choose web stack, authentication, hosting, and initial admin bootstrap/linking flow.
- Decide specification publication/edit permissions and how existing incomplete notes retain versions.
- Define review/correction approval, observation conflict resolution, and which statistics are strategically useful.
- Establish event-day response expectations, backup/restore requirements, privacy/retention policy, and school approval for student Telegram use.
- Measure extraction and dictation accuracy in a noisy venue; test reconnect bursts and real scout behavior.
- Verify automatic deployment on a future release, and coordinate backend/Mastra contract compatibility.
- Measure real costs before promising the $20 target or selecting higher tiers.
