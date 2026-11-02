# Development guide

For product behavior, architecture, data ownership, and planned features, read the [system specification](system-specification.md). For hosted configuration and invitations, use [operations](operations.md).

## Workspace setup

Use Node 24 or newer and the pinned pnpm version in `package.json`. Run `pnpm install`. If the local pnpm launcher fails, use `npx --yes pnpm@12.3.4` in place of `pnpm`. Keep the pnpm 12 lockfile format.

Copy each app's `.env.example` to its ignored `.env`, and fill credentials privately. Use the Neon development branch and development bot. Local Anthropic credentials and production credentials are separate.

Run `pnpm dev` to start both applications. For a Telegram test, the backend, Mastra, and a public tunnel must all remain running. Environment changes require restarting the affected process.

## Local Telegram setup

Run these commands from `apps/backend`:

1. Set `TELEGRAM_BOT_TOKEN` and the development `DATABASE_URL` privately in `.env`.
2. Run `node --env-file=.env src/telegram-setup.ts enroll <numeric-telegram-user-id>`. This development bootstrap creates the Team 1241 organization and Julian admin membership, maps the account, and saves a generated webhook secret. Repeating it for the same identity is safe; it is not general production onboarding.
3. Start `node --env-file=.env src/index.ts` if not using the workspace dev command.
4. In another terminal run `ngrok http 3000`.
5. Register the URL with `node --env-file=.env src/telegram-setup.ts webhook https://your-tunnel-host`. This replaces the bot's existing webhook and retains pending updates. Use only the dev bot.
6. Send a private text note. For follow-ups, reply to the bot's specific ForceReply question.

Re-register the webhook when the tunnel URL changes. Unknown accounts receive an enrollment response; groups and non-text updates are ignored. Acknowledgments are returned through Telegram's webhook-response method after commit. They are best effort; duplicate intake does not resend the acknowledgment.

## Local extraction

In `apps/mastra/.env`, configure `ANTHROPIC_API_KEY` and `MASTRA_DATABASE_URL` for the development branch's restricted Mastra login. In backend `.env`, set `MASTRA_URL=http://127.0.0.1:4111` and `EXTRACTION_ENABLED=true`. A local service token is optional; hosted authentication is covered in operations.

The extraction contract comes from `packages/scouting/src/requirements.json`. Update the version when meaning or fields change, and rebuild Mastra after edits. This is a starter template, not an official game schema. The shared package validates it and derives the structured-output schema. Invoke `scouting-extraction` through the workflow endpoint; the agent's free-text endpoint does not run deterministic finalization.

Do not run a Mastra production build while its dev watcher is active: stop the parent CLI and listener first. To run built output locally, use `node --env-file=.env .mastra/output/index.mjs` from `apps/mastra`.

## Database development

Commands run from the repository root and load `apps/backend/.env`:

| Command | Purpose |
| --- | --- |
| `pnpm db:migrate` | Apply pending forward migrations |
| `pnpm db:generate` | Introspect the public schema and replace generated types |
| `pnpm db:sync` | Migrate, then generate types only after success |
| `pnpm db:types:check` | Verify committed types against database introspection |

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
node --test packages/scouting/src/extraction.test.ts apps/backend/src/extraction-config.test.ts apps/backend/src/mastra-client.test.ts apps/backend/src/extraction-reply.test.ts
```

From `apps/backend`, run the development Neon integration tests:

```sh
node --env-file=.env --test src/telegram.test.ts src/invitations.test.ts
```

Integration tests create isolated tenant fixtures and remove them afterward. They cover intake authentication, duplicate delivery, follow-up linkage, invitation authorization, reusable links, revocation, and concurrent membership. Local owner credentials do not demonstrate production runtime-role isolation; verify restricted roles separately when permission rules change. Live model smoke tests complement deterministic tests for extraction quality.

Use `pnpm check:fix` for safe Biome fixes, `pnpm format` for formatting, or `pnpm lint` for lint only. Generated database types and vendored skills are excluded from Biome.

## Mastra build compatibility

Mastra deployer 1.80.0 parsed copied pnpm lockfiles as one YAML document; pnpm 12 produces multiple documents. Version 1.81.0 was inspected and still contained that parser. The upstream helper failed the multi-document regression test.

`patches/@mastra__deployer@1.80.0.patch`, registered in `pnpm-workspace.yaml`, parses every document, rejects parse errors, and removes only intended importer dependency keys while preserving the header and unrelated data. Installation applies the patch automatically. It was reported upstream already; do not duplicate that report.

After dependency upgrades, run `pnpm test:build-compat` and `pnpm --filter @ai-scouting/mastra build`. Remove the patch only after an upstream release passes these checks.

## Shared agent skills

Neon and Mastra skills live in `.agents/skills`; Claude Code uses relative symlinks from `.claude/skills`. Upstream sources and pinned revisions are in `.agents/skills-sources.json`. Update selected skill directories from a reviewed upstream commit, update the recorded revision together, and preserve the symlinks. These are shared repository tooling, not application packages.
