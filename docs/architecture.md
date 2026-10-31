# Architecture

## Goals

1. Work at Canadian events and at the World Championship (Worlds) with one solution.
2. Do not lose scouting data when cell or internet coverage is poor.
3. Get data to the server as fast as possible so the team can prepare for matches.
4. Keep the cost at or below about $20 USD per month.

## Constraints

- All students have phones. At Worlds, some students may not have a usable phone number, but most have a data plan.
- Coverage at venues is not reliable.
- Scouts send free text, typed or dictated with the phone keyboard.
- The system is for one team now. Other teams may get access later.

## Components

```
Scout phone (Telegram)
   │  messages wait in Telegram's outbox when there is no signal
   ↓
Telegram Bot API ──webhook──→ Mastra server (Railway)
                                 │ 1. check webhook secret
                                 │ 2. save raw entry, reply 200
                                 │ 3. run extraction workflow
                                 ↓
                              Neon Postgres
                                 ↑
                 TBA sync job ───┘  (events, teams, match schedule)
```

| Component | Choice | Purpose |
|---|---|---|
| Channel | Telegram bot | Input from scouts and questions from strategists |
| Server | Mastra on Railway | Webhook, AI workflows, TBA sync, sweeper, event mode |
| Database | Neon Postgres | Raw entries, observations, reference data |
| Event data | The Blue Alliance API v3 | Events, teams and match schedules |
| Extraction model | Claude Haiku 5.5 (`claude-haiku-5-5`), effort `low` | Free text to structured observation |
| Analysis model | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | Strategist questions |
| Optional output | Discord webhook | Match prep summaries to a strategy channel |

## Data flow

1. A scout sends a message, for example `Q42 1234 fast cycler, weak defence, climbed`.
2. If the phone has no signal, Telegram keeps the message and sends it when a connection returns.
3. The server checks the webhook secret, saves the message as a raw entry with status `pending`, and responds at once.
4. The extraction workflow:
   - Gets the active event, the match and the team from the text and the cached schedule.
   - Checks that the team plays in that match.
   - Saves an observation.
5. If information is missing or unclear, the entry gets status `needs_review`. The bot sends one question with `ForceReply`. The scout's reply links back to the entry through `reply_to_message`.
6. After a scout reconnects with many queued messages, the bot combines open questions into one message.
7. Team summaries update when each observation is saved.

### Message rules

- Each message should name the match. The server fills in the event (only one event is active) and the team (from the text or the schedule).
- Messages are processed independently. Order does not matter.
- Telegram records when the server received a message, not when the scout wrote it. Do not use time to find the match.

## Reliability

- The raw message is saved before any AI work. AI failures never lose data.
- Each Telegram `update_id` is stored with a unique constraint. Repeat deliveries do no harm.
- Each entry has a processing status: `pending`, `processing`, `done`, `needs_review` or `failed`.
- A sweeper picks up entries left in `pending` or `failed`. A missed trigger delays an entry. It does not lose it.
- Extraction can run again on any raw entry, for example after a prompt fix.

## Event mode

Event mode keeps Railway and Neon awake during events and lets them sleep at other times, so the free plans are enough.

| | Event mode on | Event mode off |
|---|---|---|
| Sweeper | Every minute | Off |
| Railway | Sweeper queries are outbound traffic, so the service stays awake | Sleeps after about 10 minutes with no outbound traffic |
| Neon | Stays awake | Suspends after about 5 minutes idle |

How event mode turns on:

- **Automatically:** on server start and on each incoming request, the server checks the TBA event dates. Event mode is on from 07:00 local time on the first day to the end of the last day.
- **Scheduled ping:** a GitHub Actions scheduled workflow calls `/health` each morning. This wakes the server before the first message.
- **Manually:** an admin sends `/eventmode on` or `/eventmode off`.

The flag is stored in the database, so a restart keeps it.

When the server is asleep, the first webhook wakes it. If the server is too slow to respond, Telegram retries. The message is late, but it is not lost.

The connection pool must close idle connections quickly (short `idleTimeoutMillis`). If it does not, Neon stays awake all month.

## Cost estimate (USD)

| Item | Per month |
|---|---|
| Railway | $0 on the free plan, or about $5 on Hobby |
| Neon | $0 on the free plan |
| Telegram | $0 |
| Claude API | About $0 with no event; about $2 to $10 in an event month |
| **Total** | **Below $20** |

Claude estimate for one event: about 2,000 extraction calls on Haiku 5.5 cost about $1. About 100 strategist questions on Sonnet 5.5 cost about $6. Measure real usage at the first event.

Cost controls:

- Haiku for extraction, with effort `low`.
- Prompt caching for the system prompt, schema and match schedule.
- A monthly spend limit in the Claude Console.

## Deferred

- **SMS (Twilio):** possible extra channel for Canadian events. US delivery needs carrier registration. See [ADR 0001](adr/0001-telegram-as-first-channel.md).
- **Native app (Expo):** build only if events show real gaps: frequent number errors, long periods with no signal, or a need for offline data.
- **Sharing with other teams:** the data model is multi-tenant from the start. Access grants come later.
