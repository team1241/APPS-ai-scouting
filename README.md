# FRC Scouting Assistant

An AI assistant that collects scouting data from students at FRC events and helps the team prepare for matches.

Scouts send free-text notes (typed or dictated) to a Telegram bot. The server stores each message, extracts structured observations with an LLM, and asks the scout a question when information is missing. Strategists ask the same bot questions about teams and matches.

## Documents

- [Architecture](docs/architecture.md): components, data flow and event mode
- [Domain context](CONTEXT.md): terms and draft data model
- [Decision records](docs/adr/): main architecture decisions and the reasons for them
- [Open questions](docs/open-questions.md): items to check before or during the build

## Status

Design stage. No code yet.
