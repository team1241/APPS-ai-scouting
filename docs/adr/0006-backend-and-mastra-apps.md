# 0006: Backend app and Mastra app

- Status: Accepted
- Date: 2026-10-31
- Supersedes: [0002](0002-single-mastra-server-and-neon.md)

## Decision

Two apps in one pnpm workspace, each a Railway service. One Neon database.

| App | Stack | Owns |
|---|---|---|
| `apps/backend` | Hono on Node 24 | Telegram webhook, raw entries, all writes to scouting tables, TBA sync, sweeper, event mode, data API |
| `apps/mastra` | Mastra | Agents and workflows (extraction, strategist chat) |

## Rules

- The backend saves the raw entry before it calls Mastra. A Mastra failure or deploy cannot lose data.
- The backend calls Mastra over HTTP. Mastra returns structured results. Only the backend writes scouting tables.
- Mastra keeps its own storage (memory, workflow state) in a separate Postgres schema in the same Neon database.
- No data sync between the apps.

## Consequences

- Two Railway services use more of the free credit. Move to Hobby (about $5 USD per month) if needed.
- Event mode must keep both services awake. The sweeper calls Mastra `/health` each minute, and the morning ping wakes both.
- Shared code (database schema, season schema) goes in `packages/` when both apps need it.
