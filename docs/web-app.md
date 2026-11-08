# Administration web app

Issue #20 introduces `apps/web`: Next.js App Router, Clerk, Tailwind CSS and locally owned shadcn/ui components. The app runs independently from the Telegram backend and is intended for Vercel. There is no Railway configuration for the web app.

## Local development

Use Node 24 and the repository's pinned pnpm version. Run `pnpm install`. Local testing uses three existing components: the frontend on port 3001, the backend on port 3000, and the Neon **development** branch. Keep the production database and Clerk production instance separate from these local settings.

### Configure the two local environments

Copy `apps/web/.env.example` to the ignored `apps/web/.env.local`. Set:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_LOCALLY
CLERK_SECRET_KEY=sk_test_REPLACE_LOCALLY
BACKEND_URL=http://localhost:3000
NEXT_TELEMETRY_DISABLED=1
CLERK_TELEMETRY_DISABLED=1
```

Create the ignored `apps/backend/.env` with the existing Neon development branch connection and the same Clerk development instance:

```dotenv
PORT=3000
DATABASE_URL=REPLACE_WITH_NEON_DEVELOPMENT_CONNECTION
CLERK_SECRET_KEY=sk_test_REPLACE_LOCALLY
CLERK_ISSUER=https://REPLACE_WITH_DEVELOPMENT_CLERK_HOST
WEB_ORIGINS=http://localhost:3001
EVENT_MODE=off
EXTRACTION_ENABLED=false
MASTRA_URL=http://127.0.0.1:4111
CLERK_TELEMETRY_DISABLED=1
```

These examples contain placeholders, not usable credentials. Obtain the exact issuer from the selected Clerk development instance; it must match the session JWT issuer, not the local frontend URL or the production Clerk hostname. `NEXT_PUBLIC_` is only for the publishable key, never a secret key. Keep both env files private and out of Git.

`BACKEND_URL` is server-only: the browser never receives backend credentials or directly queries the database. Backend verification checks signatures, issuer, expiry, authorized party and browser-session claims. Missing settings disable the web endpoints. Keep allowed origins explicit; do not trust arbitrary Vercel preview subdomains.

For login-only testing, leave Telegram bot credentials out of this worktree. `EVENT_MODE=off` pauses worker claims, and `EXTRACTION_ENABLED=false` disables the extraction worker. No running Mastra service is needed for this flow. The operator approval commands and migrations require a development owner/migration connection; deployed runtime credentials must remain restricted.

### Update the schema and start both apps

After confirming `DATABASE_URL` points to the existing **development** branch, run from the repository root:

```bash
pnpm --filter @ai-scouting/backend db:sync
pnpm --filter @ai-scouting/backend db:types:check
```

`db:sync` applies pending versioned migrations and regenerates types. Do not perform manual schema edits to provision an account. The `web_admin_access` migration must be applied before the approval/link commands below.

Start the backend and frontend in separate terminals:

```bash
# Terminal 1: also runs db:sync before starting the watcher.
pnpm --filter @ai-scouting/backend dev
```

```bash
# Terminal 2
pnpm --filter @ai-scouting/web dev
```

Open `http://localhost:3001`. Check `http://localhost:3000/health` for paused workers (`mode: "off"`, `active: false`) and `/health/db` for database connectivity. Signed-out requests to `/web/organizations` should return 401; visiting `/admin` in the browser should redirect to sign-in. The public shell and notice work without Clerk keys, while administration remains unavailable. `pnpm --filter @ai-scouting/web build` builds only the web app.

After pulling code, the next backend dev start applies newly added migrations to the configured dev branch. A Neon branch does not continuously mirror production data. If you intentionally reset it from production, its dev-only data and approval links are replaced: reapply pending working-branch migrations and provision the test account again against Clerk development. A database copied from production can contain production Clerk subjects; these must not be treated as development account links.

## Clerk instance setup

Use a dedicated development instance, separate from production. Before inviting anyone, set **Access mode → Invite-only** (`restricted`) and disable unnecessary username, name, phone and profile requirements. Do not configure Clerk Organizations, role claims, organization registration, analytics or session replay. This app intentionally uses backend memberships and live admin roles.

The dedicated **AI Scouting** development application (`app_3Lnjv2kdbKqZewSogJg5Y1bzRN6`) was created and configured during this work; its keys are in the ignored local `apps/web/.env.local`. The application uses the free development setup; no paid plan was enabled. The non-secret desired configuration is checked in at `apps/web/clerk-config.json`. Reapply it with `clerk config patch --app <app-id> --instance dev --file apps/web/clerk-config.json --yes`, and pull local keys from the `apps/web` directory with `clerk env pull --app <app-id> --instance dev --file .env.local`. Review the target app/instance before running those commands. The web SDK expects `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`; if the CLI emits the generic `CLERK_PUBLISHABLE_KEY` name, rename that variable locally without copying keys into tracked files.

Enable Google as a social connection. Development can use Clerk's shared Google credentials; production needs your Google OAuth client and the exact redirect URI shown by Clerk. Use only the authentication claims required by the provider. Do not add Google API scopes, contacts, calendar or Drive access. Email may be needed by the Google/Clerk flow; it is not copied into our database. The prebuilt sign-in component follows the instance's providers and restrictions, so deployment is not safe until Invite-only is verified on the actual instance. Hiding signup links alone is insufficient. There is no public signup or self-linking endpoint in this app.

### Adult approval and account linking

Apply migrations first. Use an owner/migration database connection for the operator commands below; the runtime backend has SELECT-only access to approval links.

1. The responsible adult lead confirms the existing admin is at least 18 **and** the age of majority in their province/territory, and is authorized to administer this team. No birthday or document is collected. Bootstrap approval can use that existing admin as the approver, after the operator confirms the lead's attestation out of band.
2. Before creating/inviting a Clerk account, record approval: from `apps/backend`, run `node --env-file=.env src/web-admin-setup.ts approve <organization-uuid> <member-uuid> <approver-member-uuid> --attest-approved-adult`.
3. In the Clerk dashboard, select **AI Scouting → Development → Invitations**, invite only that approved adult's Google email, then have them accept the invitation through Clerk's Account Portal. Verify the actual recipient and Clerk account through the team lead/existing authenticated relationship. Never infer membership from a profile name, email/domain match or an unverified Telegram claim.
4. Bind the verified Clerk subject explicitly: `node --env-file=.env src/web-admin-setup.ts link <organization-uuid> <member-uuid> <clerk-user-id>`. This requires a pending approval and a current admin role, consumes the unlinked approval, and cannot overwrite a previous link. No email, profile or provider metadata is persisted.
5. The admin signs in and selects an organization. Each page request revalidates current backend admin membership and approval with `cache: no-store`. URL selection and Clerk organization claims do not grant access. Separate organization links require separate approvals.
6. To revoke approval: `node --env-file=.env src/web-admin-setup.ts revoke <organization-uuid> <member-uuid>`. Demotion/removal also blocks subsequent checks even with an existing browser session. For suspected compromise, revoke Clerk sessions as well. Existing identity links cannot be silently reassigned; revoke, reapprove and verify the replacement identity explicitly.

### Provision a local test administrator

Use the existing organization and member IDs from the development database. The member and approver must already have the backend `admin` role. An operator can find the IDs with this read-only query on the dev branch:

```sql
SELECT o.id AS organization_id, o.name AS organization_name,
       m.id AS member_id, m.name AS member_name, m.role
FROM organization o
JOIN member m ON m.organization_id = o.id
WHERE m.role = 'admin'
ORDER BY o.name, m.name;
```

Verify which existing member belongs to the person being enrolled through the responsible adult lead. A matching name/email alone does not establish membership. For initial operator bootstrap, an already approved adult team lead can use their existing admin member ID as the approver as well.

From `apps/backend`, substitute the verified UUIDs and record the attestation **before** sending the Clerk invitation:

```bash
TEAM_ORG_ID='REPLACE_WITH_ORGANIZATION_UUID'
TEAM_ADMIN_ID='REPLACE_WITH_MEMBER_UUID'
TEAM_APPROVER_ID='REPLACE_WITH_APPROVING_ADMIN_UUID'

node --env-file=.env src/web-admin-setup.ts approve \
  "$TEAM_ORG_ID" "$TEAM_ADMIN_ID" "$TEAM_APPROVER_ID" \
  --attest-approved-adult
```

Next, select **AI Scouting → Development → Invitations** in the Clerk dashboard, invite the approved Google email and accept that invitation. Return to Clerk's **Users** page and copy the newly registered account's `user_…` ID. Link it in the same terminal:

```bash
node --env-file=.env src/web-admin-setup.ts link \
  "$TEAM_ORG_ID" "$TEAM_ADMIN_ID" user_REPLACE_WITH_VERIFIED_CLERK_ID
```

Open `http://localhost:3001/admin`, sign in with the invited Google account and select the organization. The expected result is the organization's workspace landing page. API-key management is later work; the landing page does not yet create keys or browse scouting data.

Both commands change only the database selected by this terminal's `apps/backend/.env`. Clerk registration belongs to the selected Clerk development instance. This setup does not change production. Approval and linking are explicit one-time operations; repeat attempts do not silently overwrite existing links. To replace a link, deliberately revoke it and repeat approval/linking after verifying the new identity.

### Troubleshooting local sign-in

- **Cannot register:** confirm the invitation belongs to the selected development instance and use the invited Google email. Keep Invite-only enabled.
- **No approved organizations:** the Clerk `user_…` ID needs an approval/link to the existing dev member, and that member must still be an admin.
- **Administration unavailable:** check that the backend is running, `/health/db` succeeds, the schema includes `web_admin_access`, and `BACKEND_URL` points to the local backend.
- **Repeated sign-in redirect:** check that both apps use the same Clerk development instance, `CLERK_ISSUER` is exact and `WEB_ORIGINS` includes `http://localhost:3001`. Refresh after changing keys.
- **Wrong Clerk account/application:** use `clerk whoami`, reauthenticate with `clerk auth login --yes` if needed, and select the intended app explicitly when applying configuration or pulling keys. Restart local services after replacing env settings. Existing links must be reverified when changing instances.

The operator flow intentionally does not automatically provision accounts for Telegram scouts. Accidental minor registration and deletion requests follow [Privacy boundaries](privacy.md). Publish the team's real adult contact alongside the [notice](privacy-notice.md) before inviting users.

### Telegram OIDC verification and cost gap

Public documentation confirms Clerk supports custom OIDC social connections and Telegram supports OIDC with PKCE. This is protocol compatibility, not a tested end-to-end integration with this Clerk account. Provider/plan availability, subject mapping with minimum `openid` claims, invite-only behavior when Telegram supplies no email, and production cost must be validated in the real account before enabling it. Do not enable Telegram by default or substitute another identity provider silently. Even when enabled later, a verified Telegram login does not grant membership: use the explicit approval/link process above.

If custom OIDC is unavailable on the chosen free plan or requires additional personal claims, record the limitation and obtain a product decision before purchasing or expanding collection. No paid plan is enabled by this change.

## Vercel

Import `team1241/APPS-ai-scouting` as a Next.js project with **Root Directory `apps/web`**, Node 24, and repository source outside the root available for workspace/lockfile installation. Use the pinned package manager and frozen lockfile: install from the repository root with `pnpm install --frozen-lockfile`, then build `pnpm --filter @ai-scouting/web build` (or `pnpm build` when the working directory is `apps/web`). Do not use the repository-wide build as the web build command. Next.js manages the output directory.

Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and `BACKEND_URL` per environment. The backend also needs the corresponding instance's issuer/secret and permitted web origin. Keep preview deployments on a dedicated development Clerk instance/backend, never production credentials or production membership data. Add only exact approved preview origins; deploy previews without authentication configuration when not needed. Vercel domain changes require checking Clerk redirects, Google OAuth redirects and backend authorized origins.

Clerk's public pricing reviewed 2026-11-07 lists Hobby at $0, up to 50,000 monthly retained users and a fixed seven-day session lifetime; this is ample user capacity for a small adult-admin audience, but does not establish custom OIDC availability. Vercel usage and plan eligibility depend on the actual account and organization; confirm current terms/usage limits before launch, and do not assume hosting is free or upgrade automatically. No database belongs in the web app; the existing backend owns data access.

## Validation and release

CI builds the web app, typechecks all workspaces, and runs backend route and database integration tests covering explicit linking, rejection of scouts/unapproved accounts, duplicate/replayed linking, wrong organizations, demotion/removal/revocation, RLS and generic errors. Clerk secrets are not required for the public-shell CI build.

The operator confirmed the local Google login and organization-selection test worked on 2026-11-08, using the migrated Neon development branch and the dedicated Clerk development instance. This is a manual local result; automated tests do not claim to complete a live provider login. Before release, verify invite-only rejection, multiple organizations, an expired session, unavailable backend, current-role revocation and production Vercel redirects. API-key management and data exports remain #21–#23; no placeholder actions create keys or expose scouting data.

## Primary references

- [Clerk Next.js quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart)
- [Clerk access restrictions](https://clerk.com/docs/guides/secure/restricting-access)
- [Google social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)
- [Clerk custom OIDC](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider) and [Telegram OIDC](https://core.telegram.org/bots/telegram-login)
- [Clerk token verification](https://clerk.com/docs/reference/backend/verify-token) and [pricing](https://clerk.com/pricing)
- [Vercel monorepos](https://vercel.com/docs/monorepos)
- [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next)
