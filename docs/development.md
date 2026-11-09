# Development guide

For product behavior, architecture, data ownership, and planned features, read the [system specification](system-specification.md). For hosted configuration and invitations, use [operations](operations.md).

## Workspace setup

Use Node 24 or newer and the pinned pnpm version in `package.json`. Run `pnpm install`. If the local pnpm launcher fails, use `npx --yes pnpm@12.3.4` in place of `pnpm`. Keep the pnpm 12 lockfile format.

Copy each app's `.env.example` to its ignored `.env`, and fill credentials privately. Use the Neon development branch and development bot. Local Anthropic credentials and production credentials are separate.

Run `pnpm dev` to start both applications. Backend development startup first applies pending migrations to its configured development database and regenerates types; failure prevents the backend from starting. Restart the dev command after adding a migration. Production `start` intentionally uses the restricted runtime role and does not migrate. For a Telegram test, the backend, Mastra, and a public tunnel must all remain running. Environment changes require restarting the affected process.

## Local Telegram setup

Run these commands from `apps/backend`:

1. Set `TELEGRAM_BOT_TOKEN` and the development `DATABASE_URL` privately in `.env`.
2. Run `node --env-file=.env src/telegram-setup.ts enroll <numeric-telegram-user-id>`. This development bootstrap creates the Team 1241 organization and Julian admin membership, maps the account, and saves a generated webhook secret. Repeating it for the same identity is safe; it is not general production onboarding.
3. Start `node --env-file=.env src/index.ts` if not using the workspace dev command.
4. In another terminal run `ngrok http 3000`.
5. Register the URL with `node --env-file=.env src/telegram-setup.ts webhook https://your-tunnel-host`. This replaces the bot's existing webhook and retains pending updates. Use only the dev bot.
6. Send a private text note. Select an active event before submitting a note (see operations). For follow-ups, reply to the bot's specific ForceReply question.

Re-register the webhook when the tunnel URL changes. Unknown accounts receive an enrollment response; groups and non-text updates are ignored. Acknowledgments are returned through Telegram's webhook-response method after commit. They are best effort; duplicate intake does not resend the acknowledgment.

## Local extraction

In `apps/mastra/.env`, configure `ANTHROPIC_API_KEY` and `MASTRA_DATABASE_URL` for the development branch's restricted Mastra login. In backend `.env`, set `MASTRA_URL=http://127.0.0.1:4111` and `EXTRACTION_ENABLED=true`. A local service token is optional; hosted authentication is covered in operations.

The extraction contract comes from `packages/scouting/src/requirements.json`. Update the version when meaning or fields change, and rebuild Mastra after edits. This is a starter template, not an official game schema. The shared package validates it and derives the structured-output schema. The backend invokes `POST /scouting/sessions/:runId/turn`, which starts or resumes the durable `scouting-session` workflow. Calling the agent directly bypasses deterministic finalization.

Do not run a Mastra production build while its dev watcher is active: stop the parent CLI and listener first. To run built output locally, use `node --env-file=.env .mastra/output/index.mjs` from `apps/mastra`.

## Local event-flow verification

Use the dev bot and development Neon branch with the local backend, Mastra, and ngrok running. Configure the FIRST credentials described in [operations](operations.md#events), and use an enrolled admin account for event commands.

1. Send `/event off`, then `Q42 team 1241`. Expect a rejection stating that the note was not submitted. No raw note, session, or Mastra run should be created; only rejection-delivery metadata is stored.
2. Send `/event set 2026 onosh`. Expect the Durham College event to become active. Lowercase codes are accepted.
3. Resend `Q42 team 1241` as a new message. Expect the processing acknowledgment followed by a question about climbing.
4. Send `/event off`, then reply directly to the climbing question with `They did not climb`. Expect the same session/run to resume under its original event and confirm completion.
5. Send a new note. Expect another no-active-event rejection.
6. Restore scouting with `/event set 2026 ONOSH`, or restore the event that was active before the test.

In local Mastra Studio (`http://localhost:4111/studio`), inspect Workflows → scouting-session → Runs using synthetic data. Rejected submissions never reach Mastra. The accepted note and its follow-up share a run ID; workflow snapshots hold recovery state; content-free traces are available.

The backend owns membership/admin checks, active-event admission, FIRST lookups, delivery deduplication, persistence and Telegram replies. Mastra owns extraction, specification completeness and workflow suspension/resumption. Neon enforces tenant isolation and relational constraints. Reference acquisition and participation validation are implemented in #2 and #3; this checklist verifies event context. Use the validation tests below for schedule correctness.

## Database development

Commands run from the repository root and load `apps/backend/.env`:

| Command               | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `pnpm db:migrate`     | Apply pending forward migrations                         |
| `pnpm db:generate`    | Introspect the public schema and replace generated types |
| `pnpm db:sync`        | Migrate, then generate types only after success          |
| `pnpm db:types:check` | Verify committed types against database introspection    |

Add a timestamp-prefixed TypeScript migration under `apps/backend/src/migrations`. Export async `up(db: Kysely<any>)` and `down(db: Kysely<any>)`, importing `Kysely` from `kysely`. Migration types intentionally remain independent of the current generated database types. Add a new migration rather than editing one applied to a shared database. The runner applies files in name order, moves forward only, and closes its connection pool.

Run `pnpm db:sync` and `pnpm typecheck`; commit migrations and generated types together. Never manually edit `db.generated.ts`. Generation includes `public.*`, excludes Kysely bookkeeping, and does not include Mastra storage. Ordinary typechecking uses committed types without database access.

Application queries live in `apps/backend/src/repositories`. Repositories own transactions and tenant context; routes call operations rather than building SQL. `withTenant` sets transaction-local RLS context on the query connection. Infrastructure includes the connection factory, migrations, generated types, and test fixtures. Mastra uses its own adapter.

For isolated migration validation, build a disposable database/branch and run migrations, type-drift verification, and typechecking there. This is distinct from the production rollout workflow, which applies reviewed migrations to production. Validate webhook/AI payloads at runtime; Kysely query typing does not validate JSONB contents or external input.

References: [Kysely migrations](https://kysely-org.github.io/kysely-apidoc/classes/migration.Migrator.html), [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen).

## Checks

From the root:

```sh
pnpm check
pnpm typecheck
pnpm test:build-compat
node --test apps/backend/src/frc-events.test.ts apps/backend/src/event-config.test.ts apps/mastra/src/mastra/observability.test.ts apps/mastra/src/mastra/workflows/session.test.ts packages/scouting/src/extraction.test.ts apps/backend/src/extraction-config.test.ts apps/backend/src/mastra-client.test.ts apps/backend/src/extraction-reply.test.ts
```

From `apps/backend`, run the development Neon integration tests:

```sh
node --env-file=.env --test src/telegram.test.ts src/invitations.test.ts src/events.test.ts
```

Integration tests create isolated tenant fixtures and remove them afterward. They cover intake authentication, duplicate delivery, follow-up linkage, invitation authorization, reusable links, revocation, and concurrent membership. Local owner credentials do not demonstrate production runtime-role isolation; verify restricted roles separately when permission rules change. Live model smoke tests complement deterministic tests for extraction quality.

Use `pnpm check:fix` for safe Biome fixes, `pnpm format` for formatting, or `pnpm lint` for lint only. Generated database types and vendored skills are excluded from Biome.

## Mastra build compatibility

Mastra deployer 1.80.0 parsed copied pnpm lockfiles as one YAML document; pnpm 12 produces multiple documents. Version 1.81.0 was inspected and still contained that parser. The upstream helper failed the multi-document regression test.

`patches/@mastra__deployer@1.80.0.patch`, registered in `pnpm-workspace.yaml`, parses every document, rejects parse errors, and removes only intended importer dependency keys while preserving the header and unrelated data. Installation applies the patch automatically. It was reported upstream already; do not duplicate that report.

After dependency upgrades, run `pnpm test:build-compat` and `pnpm --filter @ai-scouting/mastra build`. Remove the patch only after an upstream release passes these checks.

## Shared agent skills

Neon, Mastra and Impeccable skills live in `.agents/skills`; Claude Code uses relative symlinks from `.claude/skills`. Codex discovers the `.agents/skills` installation directly. Upstream sources and pinned revisions are in `.agents/skills-sources.json`. Update selected skill directories from a reviewed upstream commit, update the recorded revision together, and preserve the symlinks. These are shared repository tooling, not application packages.

### Impeccable

The committed skill is the `.agents/skills/impeccable` directory from the upstream `skill-v4.8.0` universal release, pinned by commit and archive SHA-256 in the sources manifest. A clone/worktree already contains the installation; no global install or npm dependency is needed. Use the project copy rather than installing duplicate command skills. Codex and Claude Code are the supported repository integrations; upstream bundles for other agents are deliberately not installed.

For administration UI work, run the project helper from the web app directory:

```bash
cd apps/web
../../.agents/skills/impeccable/scripts/impeccable context
```

Then follow the skill's workflow: `critique` for design review, `layout` for structure, `typeset` for typography, and `polish` for finishing. Product scope and implemented design decisions live in root `PRODUCT.md` and `DESIGN.md`; the shared default is code-first. Preserve the light interface and backend-authoritative access. Live-mode configuration targets `src/app/layout.tsx`; live mode is optional, not started automatically. Local credentials and running backend/frontend services must be configured separately in each worktree as described in the web-app guide.

The executable launcher uses the pinned engine version in `scripts/VERSION`, downloading a platform binary on first use when needed and checking its SHA-256 against the committed manifest. Internet access is required for that first download. Fonts are self-hosted by Next.js; building the web app may download Archivo at build time.

To reproduce or upgrade the vendored skill, download the manifest's release archive to a temporary directory, verify its SHA-256, and extract only `.agents/skills/impeccable/`. Replace that directory, include the upstream `LICENSE` and `NOTICE.md` from the same pinned commit, and update the sources manifest in the same change. Keep the existing Claude symlink. Do not extract the entire universal archive into this repository: it includes duplicate integrations and hooks. Confirm the new helper runs before committing; inspect workflow changes before adopting them.

Commit shared config and design records, including `.impeccable/config.json` and `apps/web/.impeccable/live/config.json`. Generated mocks, questions, review runs, timestamped critique snapshots and local configuration remain ignored. See [the issue #28 review record](design/issue-28-review.md) for the initial critique and validation limits.


## Mastra privacy and recovery

Studio traces retain hierarchy, span type, start/end time, allowlisted outcome, token totals and a generic failure marker. Opaque run UUIDs allow per-run lookup. The same strict output allowlist protects local trace storage and Mastra Platform; no note text, model input/output, arbitrary metadata, request context, dynamic span names or raw errors are exported. Separate log/metric/score/feedback events are not forwarded. Generic secret filtering remains defense in depth, not the privacy boundary.

Use synthetic notes and inspect private workflow recovery state when full payloads are needed for debugging. Durable snapshots still contain input/output and need the retention controls in [Privacy boundaries](privacy.md). Run IDs and timing permit correlation, so traces remain restricted operational telemetry rather than anonymous data, with a 30-day retention limit. The service token is restricted to the session endpoint and does not grant Studio access. New exporters must be wrapped with `privateTraceExporter`; do not register an unfiltered exporter or bridge.


## Event development

API-backed event configuration is available through the backend repository and Telegram commands in the [operations guide](operations.md#events). Importing or refreshing event metadata requires the FIRST API account; cached selection does not make another API request. Generic manual creation and JSON editing are not supported. Development migrations add tenant-owned event settings and a nullable session event reference; historical eventless sessions are retained without reassignment. Intake requires an active event before storing a new note or session and snapshots the event/specification context in the same transaction. Rejections retain only delivery metadata for idempotency. The worker processes only assigned sessions. Its prompt strips the `/scout` transport prefix while retaining the original raw message unchanged.

Event integration tests create isolated organizations, verify activation/reply ordering, command replay, active-event gating, rejection/accepted replay behavior, historical-session handling and cross-tenant foreign keys, and roll back a temporary restricted-role fixture to test RLS. These tests require an administrative development database connection and must not run against production. The lightweight event configuration test runs in production readiness without database fixtures.


The FIRST event client uses `FRC_EVENTS_USERNAME` and `FRC_EVENTS_AUTHORIZATION_KEY` from the backend environment. Its unit tests use a single event from FIRST's published Event Listings example (`https://frc-api-docs.firstinspires.org/`, collection `13920602-51a3938d-2026-4a5c-9f17-d87d035584cd`) stored in `src/fixtures/frc-event.json`; no API credentials are needed for CI. `windows-iana` converts FIRST's Windows zone names using Unicode CLDR mappings. The canonical IANA representative is used; cached selection preserves stored values until an explicit FIRST refresh.

## Reference import verification

Unit tests: `node --test apps/backend/src/reference-provider.test.ts`.
Integration tests: `node --env-file=.env --test src/reference.test.ts` from backend against an isolated development database. The tests cover repeated/concurrent imports, stable match IDs, rescheduling, overrides, partial retention, failure freshness and admin authorization. Public paired FIRST/TBA fixtures and source coverage are documented in `apps/backend/src/fixtures/README.md`.

For live verification, configure both providers privately and run the admin commands in operations against a development event. Check `/event reference <id>`, repeat the import after the throttle interval, and inspect stable IDs via `readReference`. Paired live FIRST/TBA verification has passed for ONOSH, ONCMP1, ONCMP2, ONCMP, ARCHIMEDES and CMPTX. ONHAM1 remains an additional offseason regression fixture.

Repeat the FIRST live smoke against a disposable database with `REFERENCE_LIVE_SMOKE=true node --env-file=.env src/reference-live-smoke.ts` from backend. It creates and cleans an isolated organization and checks two live imports for stable IDs. The default is ONOSH (28 teams, 72 matches). Set `REFERENCE_SMOKE_EVENT` to another explicit FIRST code and `REFERENCE_SMOKE_TBA_KEY` to its verified TBA key to include supplementation. All six regular-season/championship scopes passed repeated FIRST imports plus TBA supplementation without changing match IDs on 2026-11-07.

Schedule polling tests: `node --test apps/backend/src/schedule-policy.test.ts apps/backend/src/schedule-provider.test.ts`. These cover the 6 p.m. first-day boundary, event-local time/DST, and FIRST/TBA schedule acquisition, combined roster imports, and paginated roster-only backfills. Against isolated Postgres, run `node --env-file=.env --test src/schedule-job.test.ts` from backend. These tests cover all-added-event eligibility, ten-minute throttling, empty/partial responses, restart/concurrency stop conditions, TBA fallback, atomic roster/schedule saves, legacy roster-only backfills without duplicate notifications, save rollback, admin-only notifications, rate limiting and ambiguous delivery. Telegram is mocked; these tests never contact real admins.

Automatic TBA event matching: `node --test apps/backend/src/tba-event-link.test.ts`. Covers district events, championship parents/divisions, Worlds code differences, ambiguous/no matches, provider failures and manual-link preservation. Event integration tests verify persistence, replay deduplication and refresh retry.

Run one acquisition/delivery pass locally with `pnpm --filter @ai-scouting/backend schedule:sync` using the dev database and bot. This is the same command used by the Railway cron service; it closes the pool and exits. Unlike the read-only provider smoke, this command can deliver schedule-received messages to the configured organization's admins. No schedule polling runs in the HTTP backend.

## Participation validation verification

Run `node --test apps/backend/src/participation.test.ts` for the label/participation and snapshot policy. Against disposable Postgres, run `node --test apps/backend/src/participation.integration.test.ts` with `DATABASE_URL` set after applying migrations. These tests cover six alliance positions, invalid pairs, playoffs, missing/stale schedules, warn acknowledgment, strict raw persistence, off/admin settings, independent provisional notes, open-session conflicts, separate scouts, multiple teams per scout and switching events between question and reply. Existing event integration tests also cover clearing the active event during a follow-up. The combined-acquisition regression also verifies strict validation after automatic roster/schedule import and after legacy roster-only backfill, with unchanged matches/receipt and no schedule refetch. CI runs these with the reference/schedule regression gate.

The backend commits validation/extraction and its outbound question atomically; delivery claims and retries use a separate lease and never retry extraction. Telegram send/commit ambiguity still applies. Backend turns defer Mastra finalization, so run status can remain suspended after backend session completion. Backend session status is authoritative; do not resume a completed session manually as a correction.

For a dev-bot smoke test, acquire a schedule and set the event to strict. Submit an invalid pair, confirm the raw note exists and the bot asks for clarification, switch active events, then reply with the correct pair from the original event. Confirm the same session resolves under the original event. Switch to warn and try a missing playoff: verify the clarification and explicit “save unverified” path. Send a second note against an open session and verify “keep separate”; no automatic merge should occur. Restore the intended mode/event afterward. No automatic schedule polling should resume.

## Versioned observation contract

The authenticated Mastra session-turn request now optionally carries the full published `specification`. New backend calls always send the session's stored document; omission retains compatibility with older callers. The extraction schema and deterministic completeness checks derive from that document, and backend rechecks the returned version and values. Mastra's native suspension/resumption persists workflow turns; tenant authorization and atomic domain finalization belong to the backend transaction, not workflow memory.

`observation_revision` is separate from mutable `raw_entry.extraction_result`. One revision per session records event/match/team/scout, season/kind/version, values, validation snapshot, outcome and ordered raw-entry IDs. Correction revisions link `replaces_revision_id`; its unique constraint prevents forks. `readObservationHistory` returns explicit `current` and `validCoverage` flags. Independent submissions do not replace one another even when scout/match/team coincide. Only current `validated` records provide valid coverage. Provenance and previous revisions remain queryable.

Run the participation integration suite for publication while sessions are open, immutable records, explicit false, incomplete data, warning acknowledgment, repeated/concurrent finalization, correction races, target authorization, event changes and explicit re-extraction. CI runs database integration files sequentially because fixture cleanup uses owner-only transactional trigger disabling to remove immutable test records. Runtime code never imports that teardown helper. Use a disposable database; do not run those fixtures on production.

A correction that loses the finalization race becomes `superseded`, retains its draft and receives a new-current-target instruction. It is excluded from open-session conflict checks; it cannot replace the winner on a later retry.

## Team flag requests

`submitObservationFlag` resolves a scout's current finalized revision by required team and optional match, and saves an immutable request independently of scouting intake and extraction. It serializes duplicate Telegram updates, retaining the original revision and exact command on retries. `readObservationFlags` authorizes all enrolled members within the tenant and exposes the associated data/provenance for investigation. All queries and authorization stay in the typed backend repository. No model call or reference acquisition is triggered. Flags do not change validation/coverage outcomes; resolution is future administration work. Scout-facing `/correct` and `/reextract` are retired in favor of `/flag`. Telegram routes never pass correction/re-extraction targeting to intake. Internal revision/provenance machinery remains for future authorized administration, with deterministic backend tests; it has no scout-facing entry point.

Apply the additional `20261108000000_observation_flags` migration before deploying the updated backend. Regenerate types with `pnpm db:sync`. CI includes the flag command parser and participation integration cases covering authorization, ambiguous targets, no-active-event requests, concurrent retries and team visibility.

Durable delivery tests: run `DATABASE_URL=<disposable-postgres-url> node --test --test-concurrency=1 apps/backend/src/outbound.test.ts apps/backend/src/participation.integration.test.ts apps/backend/src/schedule-job.test.ts` after migration. CI includes these plus intake, invitations and existing reference/event regressions. Outbound contracts and operator/cutover instructions are in operations. Mastra snapshot caching/suspension is unchanged; delivery retries do not advance its workflow.


## Reliability verification (#10)

Run `node --test apps/backend/src/event-mode.test.ts` for timezone/DST, idle/override and worker shutdown behavior. Existing outbound tests include tenant-authorized operational reporting and restore quarantine checks. The [reliability guide](event-day-reliability.md) describes local-only synthetic event and full database/Mastra restore drills. CI runs these on dedicated disposable databases and uploads summary evidence. No new migration/types are needed; verify committed types normally. Actual Railway sleep/Wait for CI and Neon recovery policy require authorized hosted verification.

## Local administration login

Follow the [web app setup and provisioning guide](web-app.md#local-development) to use the existing Neon development branch with local backend/frontend services and Clerk development. It includes env separation, migration commands, adult approval, invitations, account linking, expected results and troubleshooting.

### Telegram connection development

Use the shared-bot variables `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and
`TELEGRAM_BOT_USERNAME` (without `@`). Run migrations with the owner connection;
the runtime role retains tenant RLS. Approved and linked web admins can connect
Telegram from `/admin/<organization-id>`, then run `/invite` in the bot.
Connection links expire in ten minutes and are consumed once. `/team` shows a button for each of the sender's teams and requires an explicit
selection when several exist.

The historical `telegram-setup.ts enroll` fixture is local development only:
set both `NODE_ENV=development` and `ALLOW_LOCAL_TELEGRAM_ENROLL=true` to use it.
Its `TELEGRAM_ORGANIZATION_ID` selects only that local enrollment fixture and no
longer controls the webhook or workers. Webhook registration requires the token
and webhook secret but no enrollment. Existing invitation URLs remain valid.

Run `telegram-connect.integration.test.ts` against an isolated migrated Postgres
database with an owner connection to check expiry, replay, tenant RLS,
disconnect, live approval and multiple-team selection.

Telegram team-selection buttons require the webhook to include both `message`
and `callback_query` in `allowed_updates`. Re-register an existing webhook with
`telegram-setup.ts webhook <https-base-url>` after deploying this change; the
setup command includes both update types. Button taps recheck current membership.
