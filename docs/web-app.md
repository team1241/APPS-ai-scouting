# Administration web app

Issue #20 introduces `apps/web`: Next.js App Router, Clerk, Tailwind CSS and locally owned shadcn/ui components. The app runs independently from the Telegram backend and is intended for Vercel. There is no Railway configuration for the web app.

## Local development

Use Node 24 and the repository's pinned pnpm version. Run `pnpm install`, copy `apps/web/.env.example` to `apps/web/.env.local`, and set Clerk development keys privately. Run `pnpm --filter @ai-scouting/web dev` (port 3001). The public shell and notice work without keys; protected administration fails closed. `pnpm --filter @ai-scouting/web build` builds only the web app.

Set `BACKEND_URL` to the existing backend origin. It is server-only: the browser never receives backend credentials or directly queries the database. Configure the backend with the same `CLERK_SECRET_KEY`, the exact Clerk JWT issuer as `CLERK_ISSUER`, and a comma-separated `WEB_ORIGINS` list of exact web origins. Local development uses `http://localhost:3001`. Backend verification checks signatures, issuer, expiry, authorized party and browser-session claims. Missing settings disable the web endpoints. Keep origins explicit; do not trust arbitrary Vercel preview subdomains.

## Clerk instance setup

Use a dedicated development instance, separate from production. Before inviting anyone, set **Access mode → Invite-only** (`restricted`) and disable unnecessary username, name, phone and profile requirements. Do not configure Clerk Organizations, role claims, organization registration, analytics or session replay. This app intentionally uses backend memberships and live admin roles.

The dedicated **AI Scouting** development application (`app_3Lnjv2kdbKqZewSogJg5Y1bzRN6`) was created and configured during this work; its keys are in the ignored local `apps/web/.env.local`. No users or paid plan were added. The non-secret desired configuration is checked in at `apps/web/clerk-config.json`. Reapply it with `clerk config patch --app <app-id> --instance dev --file apps/web/clerk-config.json --yes`, and pull local keys from the `apps/web` directory with `clerk env pull --app <app-id> --instance dev --file .env.local`. Review the target app/instance before running those commands. The web SDK expects `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`; if the CLI emits the generic `CLERK_PUBLISHABLE_KEY` name, rename that variable locally without copying keys into tracked files.

Enable Google as a social connection. Development can use Clerk's shared Google credentials; production needs your Google OAuth client and the exact redirect URI shown by Clerk. Use only the authentication claims required by the provider. Do not add Google API scopes, contacts, calendar or Drive access. Email may be needed by the Google/Clerk flow; it is not copied into our database. The prebuilt sign-in component follows the instance's providers and restrictions, so deployment is not safe until Invite-only is verified on the actual instance. Hiding signup links alone is insufficient. There is no public signup or self-linking endpoint in this app.

### Adult approval and account linking

Apply migrations first. Use an owner/migration database connection for the operator commands below; the runtime backend has SELECT-only access to approval links.

1. The responsible adult lead confirms the existing admin is at least 18 **and** the age of majority in their province/territory, and is authorized to administer this team. No birthday or document is collected. Bootstrap approval can use that existing admin as the approver, after the operator confirms the lead's attestation out of band.
2. Before creating/inviting a Clerk account, record approval: from `apps/backend`, run `node --env-file=.env src/web-admin-setup.ts approve <organization-uuid> <member-uuid> <approver-member-uuid> --attest-approved-adult`.
3. Invite only that approved adult through Clerk's invite-only Account Portal. Verify the actual recipient and Clerk account through the team lead/existing authenticated relationship. Never infer membership from a profile name, email/domain match or an unverified Telegram claim.
4. Bind the verified Clerk subject explicitly: `node --env-file=.env src/web-admin-setup.ts link <organization-uuid> <member-uuid> <clerk-user-id>`. This requires a pending approval and a current admin role, consumes the unlinked approval, and cannot overwrite a previous link. No email, profile or provider metadata is persisted.
5. The admin signs in and selects an organization. Each page request revalidates current backend admin membership and approval with `cache: no-store`. URL selection and Clerk organization claims do not grant access. Separate organization links require separate approvals.
6. To revoke approval: `node --env-file=.env src/web-admin-setup.ts revoke <organization-uuid> <member-uuid>`. Demotion/removal also blocks subsequent checks even with an existing browser session. For suspected compromise, revoke Clerk sessions as well. Existing identity links cannot be silently reassigned; revoke, reapprove and verify the replacement identity explicitly.

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

Before release, test Google sign-in and invite-only rejection on the configured instance, operator approval/linking, multiple organizations, an expired session, unavailable backend, current-role revocation and Vercel redirects. Automated tests do not claim a live provider login was completed. API-key management and data exports remain #21–#23; no placeholder actions create keys or expose scouting data.

## Primary references

- [Clerk Next.js quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart)
- [Clerk access restrictions](https://clerk.com/docs/guides/secure/restricting-access)
- [Google social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)
- [Clerk custom OIDC](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider) and [Telegram OIDC](https://core.telegram.org/bots/telegram-login)
- [Clerk token verification](https://clerk.com/docs/reference/backend/verify-token) and [pricing](https://clerk.com/pricing)
- [Vercel monorepos](https://vercel.com/docs/monorepos)
- [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next)
