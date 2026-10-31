# FRC Scouting Assistant

An AI assistant that collects scouting data from students at FRC events and helps the team prepare for matches.

Scouts send free-text notes (typed or dictated) to a Telegram bot. The server stores each message, extracts structured observations with an LLM, and asks the scout a question when information is missing. Strategists ask the same bot questions about teams and matches.

## Documents

- [Architecture](docs/architecture.md): components, data flow and event mode
- [Domain context](CONTEXT.md): terms and draft data model
- [Decision records](docs/adr/): main architecture decisions and the reasons for them
- [Open questions](docs/open-questions.md): items to check before or during the build

## Status

Scaffold stage. `apps/backend` and `apps/mastra` run but have no features yet. Run `pnpm install`, then `pnpm dev`.

## Database development

Kysely handles scouting queries and migrations. See [the database workflow](docs/database.md) for setup, migration authoring, type generation, and automated drift checks.

## Agent skills

Project skills for Codex live in `.agents/skills/`; Claude Code uses relative symlinks in `.claude/skills/` to the same files. They cover Neon Postgres, Neon branching, and Mastra development across both apps.

Upstream repositories and pinned commit revisions are recorded in `.agents/skills-sources.json`. To update, download the selected skill directories from a reviewed upstream commit, replace their matching directories in `.agents/skills/`, and update the recorded revision together. Keep the Claude symlinks pointing to the shared copies.
