# 0002: One Mastra server and one Neon database

- Status: Accepted
- Date: 2026-10-31

## Context

The backend must receive Telegram webhooks, store data, run AI extraction and analysis, and sync event data from The Blue Alliance. We considered one server or two (an agent server and a scouting server).

## Decision

Run one persistent Mastra server on Railway, with one Neon Postgres database.

## Reasons

- Two servers that copy data between them add a place where data can be lost or get out of step.
- The work (ingest, extraction, summaries, chat) is all "turn raw entries into useful data". One server keeps it simple.
- A persistent server can run the sweeper and event mode in process. No external queue is needed.
- Neon gives Postgres with scale to zero, which suits a project that is idle between events.

## Reliability inside one server

- The webhook handler saves the raw entry before any AI work, and does not depend on AI code.
- AI failures leave entries in `pending` or `failed` for the sweeper.

## Options rejected

| Option | Reason |
|---|---|
| Two servers with data sync | More failure points, more to deploy |
| Supabase | Its Realtime and database webhooks are not needed with Telegram. Neon is preferred. |
| Serverless functions | Long AI calls, the sweeper and event mode suit a persistent process |
| Render free plan | Slow wake from sleep |

## When to revisit

Split into two services, still with one database, only if:

- Other teams use a public API that must not depend on AI deploys, or
- AI load needs to scale apart from the rest.
