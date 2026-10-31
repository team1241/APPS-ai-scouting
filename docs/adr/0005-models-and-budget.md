# 0005: Models and budget

- Status: Accepted
- Date: 2026-10-31

## Context

Budget is about $20 USD per month for all services. Extraction runs on every message. Strategist questions are fewer but need better reasoning.

## Decision

| Task            | Model                                   | Settings                                               |
| --------------- | --------------------------------------- | ------------------------------------------------------ |
| Extraction      | Claude Haiku 5.5 (`claude-haiku-5-5`)   | Effort `low`, structured output with the season schema |
| Strategist chat | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | Default effort, tools for data queries                 |

Prices at 2026-10-06, per million tokens: Haiku 5.5 is $0.10 input and $0.50 output. Sonnet 5.5 is $2 input and $10 output.

## Estimate for one event

| Task            | Assumptions                                                    | Cost     |
| --------------- | -------------------------------------------------------------- | -------- |
| Extraction      | 2,000 messages, about 2,000 input and 500 output tokens each   | About $1 |
| Strategist chat | 100 questions, about 20,000 input and 2,000 output tokens each | About $6 |

## Rules

- Use prompt caching for the system prompt, schema and schedule.
- Set a monthly spend limit in the Claude Console.
- Use typed tools for data queries (for example `getTeamStats`). Do not let the model write SQL.
- Move extraction to Sonnet only if tests show Haiku is not accurate enough. Sonnet extraction costs about $15 or more per event.
