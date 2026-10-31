# Database workflow

The backend owns scouting tables in Neon Postgres, using Kysely and the existing pg pool. Mastra storage belongs in a separate schema. Database code stays in the backend until another package needs it.

## Setup

Copy `apps/backend/.env.example` to `apps/backend/.env` and set DATABASE_URL to a development Neon branch connection string. Never commit credentials. Commands below run from the repository root and load that environment file.

## Commands

- `pnpm db:migrate`: apply pending migrations.
- `pnpm db:generate`: introspect the live public schema and replace `apps/backend/src/db.generated.ts`.
- `pnpm db:sync`: apply migrations, then generate types; generation only runs after migrations succeed.
- `pnpm db:types:check`: introspect and fail if committed types differ, without rewriting them.
- `pnpm typecheck`: check both apps using the committed types; no database required.

## Changing the schema

Add a timestamp-prefixed TypeScript file to `apps/backend/src/migrations`, for example `20261031120000_create_events.ts`. Export async `up(db: Kysely<any>)` and `down(db: Kysely<any>)`, importing the Kysely type from `kysely`. Use the schema builder or SQL in these functions. Migration types deliberately stay independent of current application types so old migrations remain runnable. Files run in name order. Never edit a migration already applied to a shared database; add another migration instead.

Run `pnpm db:sync`, then `pnpm typecheck`, and commit the migration and generated types together. Review migrations before applying them to production. The migration runner only moves forward and exits with an error on failure; it always closes its connection pool.

Types come from the actual database schema, not from parsing migration source. No migration snapshot files are produced. The checked-in DB interface is initially an empty bootstrap because no scouting tables have been created; replace it with codegen output once a database is connected. Never manually maintain generated table interfaces.

## Automated verification

In CI, provision a disposable Postgres database or Neon branch, provide DATABASE_URL, run `pnpm db:migrate`, `pnpm db:types:check`, and `pnpm typecheck`. This detects missing regeneration against the schema built from migrations. Do not point this migration verification at production. Type generation and verification require database access; ordinary typechecking does not.

Kysely checks queries at compile time. Validate incoming webhook and AI data separately at runtime. JSONB structure requires application-level validation and deliberate type overrides when its domain model is defined.

References: [Kysely migrations](https://kysely-org.github.io/kysely-apidoc/classes/migration.Migrator.html), [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen).
