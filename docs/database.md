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

Types come from the actual database schema, not from parsing migration source. No migration snapshot files are produced. The checked-in DB interface is generated from the intake tables. Generation explicitly includes `public.*` and excludes Kysely bookkeeping tables, keeping Mastra storage out of backend types. Never manually maintain generated table interfaces.

## Automated verification

In CI, provision a disposable Postgres database or Neon branch, provide DATABASE_URL, run `pnpm db:migrate`, `pnpm db:types:check`, and `pnpm typecheck`. This detects missing regeneration against the schema built from migrations. Do not point this migration verification at production. Type generation and verification require database access; ordinary typechecking does not.

Kysely checks queries at compile time. Validate incoming webhook and AI data separately at runtime. JSONB structure requires application-level validation and deliberate type overrides when its domain model is defined.

References: [Kysely migrations](https://kysely-org.github.io/kysely-apidoc/classes/migration.Migrator.html), [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen).

## Mastra production storage

The Mastra deployment uses `MASTRA_DATABASE_URL`, separate from the backend connection. Its dedicated `ai_scouting_mastra` login has `USAGE` and `CREATE` on the `mastra` schema, and no elevated role attributes or memberships. The database administrator owns the schema; Mastra owns the tables it creates there. Administrators retain access.

Public access to the `mastra` and `public` schemas is revoked. Backend roles that do not own the scouting schema must receive explicit schema and table grants. Future schemas must also revoke PUBLIC access to preserve isolation. Credentials are stored in the Mastra production environment, never in Git.

The Postgres storage adapter initializes its tables automatically. Local development uses a separate `ai_scouting_mastra_dev` login on the Neon development branch, restricted to its own `mastra` schema. Its connection is stored in the ignored `apps/mastra/.env` as `MASTRA_DATABASE_URL`. Production credentials must not be used for local development.

## Intake schema and tenant context

The initial migration creates `organization`, `member`, `channel_identity`, and `raw_entry`. Composite foreign keys prevent an identity or raw entry from naming a member in another organization. Delivery IDs are unique per organization and channel; they are text to preserve external identifiers without JavaScript integer conversion. This assumes one bot per channel; multiple bots require a transport-account key before onboarding them.

All four tables enforce row-level security using `app.organization_id`. Run tenant operations inside a transaction and set the context with `SELECT set_config('app.organization_id', tenant_id, true)` on that same transaction connection. Missing context returns no rows and prevents inserts. Use an application role without superuser or BYPASSRLS privileges; the Neon owner connection is administrative and does not demonstrate runtime isolation. Initial organization creation must use an explicit UUID matching the transaction context.

Channel identities are scoped to an organization, so webhook routing must resolve the organization through a trusted bot configuration or enrollment flow before querying identities. Raw message text and receipt metadata are immutable application data; processing may update status and follow-up linkage.

## Backend repositories

Application queries live in `apps/backend/src/repositories/`. Routes and setup commands call operations such as `saveIncomingNote` and `enrollMember`; they do not build SQL queries. Repositories own transaction boundaries, tenant context, and persistence rules. `withTenant` sets transaction-local RLS context on the same connection as the queries. Enrollment serializes on the organization row so concurrent retries reuse one member. Database lifecycle and health checks are exposed by `repositories/database.ts`.

The connection factory, migrations, generated types, and integration-test fixtures remain database infrastructure. Mastra uses its own storage adapter and schema.
