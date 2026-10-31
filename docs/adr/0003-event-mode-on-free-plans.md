# 0003: Event mode on free plans

- Status: Accepted
- Date: 2026-10-31

## Context

The team uses the system only a few weeks per year. Railway and Neon free plans sleep or suspend idle services. During events, responses must be fast and steady.

## Decision

Add an event mode. When it is on, the sweeper queries the database every minute. This keeps Railway (outbound traffic) and Neon (active queries) awake. When it is off, both sleep.

Event mode is `auto`, `on` or `off`:

- `auto`: on from 07:00 local time on the first event day to the end of the last day, from TBA dates.
- `on` or `off`: set by an admin with `/eventmode`.

A sleeping server cannot turn itself on, so:

- The server checks event mode on startup and on each incoming request.
- A GitHub Actions scheduled workflow calls `/health` each morning.

## Consequences

- The first message to a sleeping server is a few seconds late. Telegram retries if the server is slow, so no data is lost.
- The connection pool must close idle connections quickly, or Neon never suspends.
- If free-plan limits are too low, move Railway to Hobby (about $5 USD per month). This stays inside the $20 budget.
