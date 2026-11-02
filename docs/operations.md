# Operations guide

The [system specification](system-specification.md) owns architecture, environment identities, costs, reliability limitations, and future behavior. Use [development](development.md) for local setup and tests.

## Production configuration

Configure the backend on Render with its production bot token, webhook secret, organization ID, restricted pooled `DATABASE_URL`, `MASTRA_URL`, matching `MASTRA_SERVICE_TOKEN`, and `EXTRACTION_ENABLED=true`. Use each app's `.env.example` as the variable reference. Never use the production bot or database for local tests.

Mastra Platform receives the production `ANTHROPIC_API_KEY`, `MASTRA_DATABASE_URL`, and the same application service token. This token is not a platform-wide deployment credential. Backend requests require HTTPS, refuse redirects, and authorize only the extraction workflow endpoint; Studio retains platform authentication. Startup validates required extraction configuration before the backend listens.

Mastra's database login has USAGE/CREATE only in its dedicated schema; the administrator owns the schema and the adapter creates its tables. Development uses a separate login/branch. PUBLIC access to `public` and `mastra` is revoked; explicitly grant runtime permissions and review future schemas for equivalent isolation. Backend runtime cannot migrate or administer roles. Keep administrative migration credentials out of deployed runtime configuration.

Ignored `apps/backend/.env.render` is a local transfer aid for production runtime settings, not a complete deployment environment or a source-controlled secret store.

## Release workflow

GitHub Actions `Production readiness` runs on pushes to `main` or manual dispatch. The workflow file is the authoritative check list. The production owner/unpooled connection belongs in the repository secret `PRODUCTION_MIGRATION_DATABASE_URL` and is exposed only to migration verification. Jobs serialize migrations without cancelling a running migration. Generated types must match the migrated database.

Render is configured for `checksPass`. A failed migration must block deployment; resolve it before any manual rollout. Keep schema changes compatible with the previous application during rollout. The known successful-check/no-deployment incident remains tracked in GitHub; verify the actual deployed SHA after releases rather than assuming the trigger worked.

Mastra has a separate deployment lifecycle. Deploy compatible agent contracts before enabling a backend that depends on them, then smoke-test authorized extraction and rejected unauthorized requests. When using a deployment env-file, include only intended production overlays; never upload the entire local development environment. Keep the pnpm build-compatibility check described in development.

Register the production Telegram webhook against the Render backend's `/telegram/webhook` with the configured secret. `/health` checks process availability; `/health/db` checks database access. Check webhook status/pending updates and processing failures when diagnosing missing replies. Do not expose credential values in logs or diagnostic output.

## Invitations and membership

In a private bot chat, an enrolled admin can use:

- `/invite [label]`: create a reusable scout enrollment link.
- `/invites`: list the 20 newest invitation IDs, labels, usage counts, and status.
- `/revokeinvite <id>`: disable further joins without removing enrolled members.

Share the returned link with the intended team. Each user opens it and taps Start. Links have no expiry or usage cap; forwarded links work until revoked. Joining repeatedly neither duplicates membership nor changes an existing role. Only token hashes are stored, so keep the original creation response: listing cannot recover the link. If that response is lost, create a fresh invitation and revoke the old one by ID. Duplicate creation updates do not create extra links.

Commands bypass extraction. Group chats cannot create or redeem invitations. Other-organization tokens are rejected. Concurrent joining/revocation is serialized in database transactions. Enrollment grants scout access; initial admins and role changes require an administrative path.

Invitation rollout requires both invitation migrations, including the restricted runtime permission grant, before backend deployment. No invitation-specific environment variable is needed. Test the dev bot before production.
