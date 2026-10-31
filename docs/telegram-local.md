# Local Telegram intake

Use a development bot and the Neon development branch. Run backend commands from `apps/backend`; environment files are ignored by Git.

1. Set `TELEGRAM_BOT_TOKEN` in `.env` privately.
2. Run `node --env-file=.env src/telegram-setup.ts enroll <numeric-telegram-user-id>`. This creates the local Team 1241 organization and Julian admin membership, maps the Telegram account, and saves a generated webhook secret. Repeating enrollment for the same account is safe.
3. Start `node --env-file=.env src/index.ts`.
4. Run `ngrok http 3000` in another terminal.
5. Register the tunnel with `node --env-file=.env src/telegram-setup.ts webhook https://your-tunnel-host`. This replaces the bot's existing webhook; use a development bot. Pending Telegram updates are retained.
6. Send a private text message to the bot. A committed entry receives “Received your scouting note. Processing it now…” Unknown accounts receive an enrollment message. Group messages and non-text updates are ignored.

Restart the backend after enrollment or environment changes. Re-register the webhook whenever the tunnel URL changes. Keep both processes running during testing.

Run the Neon integration test with `node --env-file=.env --test src/telegram.test.ts`. It creates an isolated tenant fixture, tests authentication, database-failure responses, unknown identities, and concurrent duplicate delivery, then removes the fixture.

Intake stores notes as pending. See [extraction](extraction.md) to enable the local specification-driven extractor. Acknowledgments use Telegram's webhook response method after the database commit. They are best effort: a failed reply does not undo the saved message, and duplicate deliveries do not resend acknowledgments. The trusted local organization setting determines tenant routing; this is a one-bot local setup.
