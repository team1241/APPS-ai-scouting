# FRC Scouting Assistant

Team 1241's scouting assistant collects typed or keyboard-dictated Telegram notes, stores the original messages, extracts structured data, and asks for missing information. Strategy tools and automatic match notifications are planned.

## Documentation

- [System specification](docs/system-specification.md): requirements, architecture choices, implementation snapshot, event configuration, future features, costs, and open decisions.
- [Development guide](docs/development.md): local setup, database migrations, tests, build compatibility, and shared agent skills.
- [Operations guide](docs/operations.md): production configuration, release workflow, and invitation management.
- [Event-day reliability](docs/event-day-reliability.md): worker modes, queue measurements, simulated evidence, cost assumptions and restore procedures.
- [Contribution instructions](AGENTS.md): repository-specific issue, branch, and pull-request conventions.

## Work tracking

Use the [AI Scouting project](https://github.com/orgs/team1241/projects/1) and [GitHub issues](https://github.com/team1241/APPS-ai-scouting/issues) for priorities, acceptance criteria, dependencies, and progress. Durable requirements live in the specification.

## Getting started

Use Node 24+ and the pinned pnpm version, run `pnpm install`, configure development environment files, then run `pnpm dev`. Follow the development guide to enroll a dev Telegram account and register a tunnel webhook.
