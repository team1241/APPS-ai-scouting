# Specification-driven extraction (local prototype)

Edit `packages/scouting/src/requirements.json` to change the versioned scouting specification. This starter template requires match label, team number, and an explicit climb outcome; notes are optional. It is a review template, not an official season schema. Increment its version when fields or meaning change. Supported field types are text, positive integer, and boolean. Required fields, descriptions, and the exact follow-up questions all come from this document. Rebuild Mastra after changes.

The shared scouting package validates the specification and derives the model's structured-output schema. Missing or ambiguous values are null. Code computes missing requirements and combines their questions; explicit false counts as present. The Haiku extractor treats scout input as data, with no database tools or writes.

Mastra registers the `extractor` agent and `scouting-extraction` workflow. The workflow is the validated API for backend use; calling the agent's free-text endpoint directly does not perform the deterministic completeness check. Local Mastra reads `ANTHROPIC_API_KEY` and its separate storage connection from `apps/mastra/.env`.

The backend's opt-in worker uses `MASTRA_URL=http://127.0.0.1:4111` and `EXTRACTION_ENABLED=true`. It claims one pending entry at a time, calls the workflow over HTTP, validates the result again, and sends missing-field questions through Telegram ForceReply. Reply to that specific question so its message ID links the answer to the original entry. All raw messages remain intact; follow-up entries point to their original parent. The worker re-extracts the original plus its replies. Other members cannot attach replies to your entries.

Draft extraction results and specification versions are stored in `raw_entry.extraction_result`; these are not confirmed domain observations. Complete template extraction sets the raw entry to `done`. Missing requirements set `needs_review`. Failures retry after a minute, at most three attempts; a five-minute lease allows recovery from interrupted processing. Exhausted attempts require manual retry. The worker is disabled by default. Hosted Mastra requires HTTPS and `MASTRA_SERVICE_TOKEN`; local development may omit the token. It polls while enabled, which keeps the connected database awake.

Limitations: one team and match per note; no event/schedule cache validation yet; no cross-entry question batching; no final observation schema. Telegram sends and database commits cannot be atomic, so a process failure after sending can repeat a question on retry. Keep the local processes running during a test. Hosted extraction uses a dedicated service token restricted to the extraction workflow endpoint.

Verification: `node --test packages/scouting/src/extraction.test.ts`; from `apps/backend`, `node --env-file=.env --test src/telegram.test.ts`. Tests cover null versus false, invalid values, deduplicated intake, question linkage, reprocessing, and preservation of original text. Live model smoke checks additionally cover a missing climb followed by an explicit failed climb.

## Build compatibility

Mastra deployer 1.80.0 parses copied pnpm lockfiles as a single YAML document when replacing workspace links with packaged dependencies. pnpm 12 uses multiple documents, so the original helper fails during production builds. Deployer 1.81.0 was also inspected and still contains that parser.

`patches/@mastra__deployer@1.80.0.patch`, registered in `pnpm-workspace.yaml`, makes the helper parse every document, reject parse errors, and remove only the intended importer dependency keys. It preserves the pnpm header and unrelated importer/package data. pnpm installs apply the version-specific patch automatically. The root lockfile stays in pnpm 12 format.

Run `pnpm test:build-compat` and `pnpm --filter @ai-scouting/mastra build` after dependency upgrades. The regression test exercises the installed dependency helper for both single-document and multi-document lockfiles. The original upstream helper was verified to fail the multi-document test; the patched helper and full application build pass. Remove this patch once an upstream release resolves the issue and passes these checks. The bug was already reported through the Mastra skill; no duplicate report was submitted.

## Hosted backend configuration

Set `MASTRA_URL=https://ai-scouting.server.mastra.cloud` and the same `MASTRA_SERVICE_TOKEN` on Render and Mastra. This is an application credential, not an organization-wide Mastra deployment token. The backend sends it as a Bearer header and refuses redirects. Mastra authorizes only POST requests to the scouting extraction workflow for this credential. Platform Studio access continues through platform authentication.

With extraction enabled, the backend validates the database, Telegram configuration, Mastra URL and service token before listening. Use the production Neon runtime connection and production bot configuration on Render. Enable `EXTRACTION_ENABLED=true` only after Mastra authentication is deployed.
