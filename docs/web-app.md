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

Enable Google as a social connection. Development can use Clerk's shared Google credentials; production needs your Google OAuth client and the exact redirect URI shown by Clerk. Use only the authentication claims required by the provider. Do not add Google API scopes, contacts, calendar or Drive access. Email may be needed by the Google/Clerk flow; provider profile emails are not copied into our database. Public applicants separately supply a contact email for application review. The prebuilt sign-in component follows the instance's providers and restrictions, so deployment is not safe until Invite-only is verified on the actual instance. Hiding signup links alone is insufficient. There is no public account signup or self-linking endpoint in this app. The public access application collects a request only; it does not create a Clerk account or membership.

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

## Public access applications

Issue #30 adds `/request-access`, linked from the home page and available without Clerk configuration. It collects name, contact email, FRC team number, a single role (mentor, lead mentor, teacher, other), and an adult attestation. Signed-in visitors are directed to their existing teams; signed-in team creation is tracked separately in #31.

The website uses TanStack Form with Zod validation and shadcn Field, Input, Select and Checkbox components; controlled values persist after validation and transport failures. The public Next.js server action posts only these details plus a submission UUID to `POST /web/access-applications`. Configure the existing server-only `BACKEND_URL`; production uses HTTPS. The backend validates a bounded request and saves an `access_application` with status `pending` and a server timestamp. Retrying a submission or applying again for the same email/team while pending returns the same generic receipt without creating a second pending record or revealing whether one already exists. The endpoint never accepts approval state or creates identities, memberships, teams, or approval links.

Apply the versioned migration through the normal `db:sync` process. Since #33, the runtime submits through a database function and reads applications only as a recorded platform operator; see [Operator review and team provisioning](#operator-review-and-team-provisioning). Do not grant this table's SELECT privileges to public or tenant-scoped routes. Email/Resend integration remains out of scope. The completion state confirms receipt and explicitly says no email has been sent.

Name and email are applicant-supplied contact details, not verified identity. Never use them alone to provision or link an account. Follow the existing adult approval/linking procedure after review. Delete application contact details within 90 days of submission, including unresolved requests; the operator must schedule and verify cleanup with an owner connection because the runtime cannot delete these records. Include applications in privacy access/deletion requests and backup deletion handling. Avoid logging request bodies or application details.

The same issue restyles the public entrance (home, sign-in and request access) and the shared header and footer around the Theory6 Apps badge. `DESIGN.md` records the decisions under Visual direction, Administration navigation and Public entrance. Each worktree needs its own ignored `apps/web/.env.local` and `apps/backend/.env`; without the backend env, `/admin` cannot load teams, and without the Clerk keys, Sign in returns to the home page.

Validation covers route inputs, persistence, concurrent retries, database privileges/RLS, server-action failure recovery, and existing admin authorization. CI runs the application tests against disposable Postgres. No live Clerk account or email delivery is required for the public flow.

## Operator review and team provisioning

Issue #33 adds platform operators, who review access applications at `/operator`. Clerk sign-in alone does not make someone an operator. Operators are recorded in the `platform_operator` table with an owner/migration connection. From `apps/backend`:

```bash
node --env-file=.env src/platform-operator-setup.ts add user_REPLACE_WITH_CLERK_ID "Operator name"
node --env-file=.env src/platform-operator-setup.ts remove user_REPLACE_WITH_CLERK_ID
```

Use the command for the first operator. After that, operators manage the list at `/operator/operators`:

- **Add:** enter a name and email. The backend looks the email up in Clerk. If exactly one account has it as a verified email, that account becomes an operator at once, and the email is not stored.
- **Invite (#35):** if no account has that verified email, the backend records an `operator_invitation` and sends a Clerk invitation with `publicMetadata.operatorInvitationId`. It expires in 7 days. When an account with no teams loads `/web/organizations`, the backend reads that server-set metadata and the account's verified emails from Clerk. If an email matches an open, unexpired invitation, `claim_operator_invitation` adds the operator, recording the inviter as `added_by`. Invitees get no team; team assignment is separate work.
- **Pending invitations** appear under "Invited" with Resend and Cancel. Resend revokes the earlier Clerk invitation, sends a new one and restarts the 7 days. Cancel closes the database record first, then revokes the Clerk invitation, so a failed Clerk call cannot grant access. If sending fails when inviting, the record is closed and the operator sees an error. The invitee's email is stored only while the invitation is open; accepting, cancelling or replacing an expired invitation clears it.
- **Remove:** any other operator, after a confirmation dialog. An operator cannot remove themselves, so at least one always remains.
- Each record shows who added it ("setup command" for CLI additions).

Every operator request rechecks the record, so removal takes effect on the next request. Operators see an Operator item in the main navigation, with a count of waiting applications, and an operator navigation row with Applications, All teams (#41) and Operators. An operator with no team is sent from team selection to `/operator`.

**Submission.** `POST /web/access-applications` calls `submit_access_application`. A retry of the same submission ID returns the same receipt. A new application for a team number that already has a pending, rejected or approved application, or an existing organization, gets HTTP 409 and a team-number error on the form. This tells the applicant that the team has a record; this was an explicit product decision.

**Approval.** "Approve and invite" calls `approve_access_application` in one transaction. It creates the organization with the operator-confirmed team name, an `admin` member with the applicant's name, and a `web_admin_access` approval (`policy_version = operator-approved-v1`, self-approved bootstrap; the reviewing operator is recorded on the application). It refuses applications that are not pending and teams that already have an organization. After the commit, the backend sends a Clerk invitation to the application email with `publicMetadata.accessApplicationId`. Invitation links open the web app's `/sign-up` page, which accepts the Clerk ticket and then continues to `/admin`, where the account is linked. The backend uses `WEB_INVITATION_REDIRECT_URL` when set, otherwise the first `WEB_ORIGINS` entry plus `/sign-up`. Without a redirect, Clerk's development Account Portal ends on a generic `/default-redirect` page. `/sign-up` without a ticket redirects to `/sign-in`, because sign-up is invite-only. If the invitation fails (for example, the email already has a Clerk account), the team stays provisioned and the row shows "Invitation not sent" with "Resend invitation".

**Linking.** When a signed-in account has no linked teams, `GET /web/organizations` reads the user from the Clerk Backend API. If the server-set public metadata names an approved application and one of the account's verified emails matches the application email, `claim_access_application` links the Clerk subject to the new admin member. Existing admins never trigger this Clerk call. A claimed application cannot be linked to a different account; replace a link with the revoke and approve steps above.

**Rejection.** Reject asks for confirmation in a dialog. The applicant is not notified, and the team cannot apply again. To allow a new application, an owner must delete the rejected row with the owner connection.

**Database access.** The runtime role reads `access_application` and `platform_operator` only through row-level security on `app.clerk_user_id`, and has no INSERT, UPDATE or DELETE on either table. All state changes go through the `SECURITY DEFINER` functions in `20261109010000_platform_operators.ts`, `20261109020000_operator_management.ts` and `20261109030000_operator_invitations.ts`. The runtime has no table privileges on `operator_invitation`. Those functions must be owned by the migration role, which bypasses row-level security, as the existing operator commands already require.

Validation covers route authorization and errors, duplicate-team rules under concurrency, provisioning, claim email matching, operator removal and runtime-role privileges against disposable Postgres. The review page was checked at desktop and phone widths with fixture data. A live Clerk invitation and claim were not tested end to end.

## Team administrator invitations

Issue #40 lets an approved team admin invite another adult to administer the same team, from the **Administrators** section of `/admin/<organization>`. It replaces the setup commands above for existing teams. New-team creation stays with operator approval (#31) and operator management stays at `/operator/operators`.

**Inviting.** The admin enters the person's name and email and confirms: "I confirm this person is at least 18 and the age of majority where they live, and is authorized to administer this team." The backend rechecks that the session account is a linked, approved admin of that team (`team_admin_actor`) on every operation. A request for another team, or a forged team ID, gets the same 404 as a missing team. The backend then looks the email up in Clerk:

- **No account:** `create_team_admin_invitation` records a `team_admin_invitation`, and Clerk sends an invitation with `publicMetadata.teamAdminInvitationId`. It expires in 7 days and lands on `/sign-up`, like other invitations. If Clerk cannot send it, the record is cancelled and the admin sees an error. The invitation is never shown as sent.
- **Existing account:** the email is verified on exactly one Clerk account. The invitation is bound to that account and no email is sent. The person sees it under "Invitations" on `/admin` the next time they open it, with "Accept and open team". This covers admins of other teams and platform operators.

An email that already has a pending invitation for the team, or an account that is already an admin of the team, is refused.

**Accepting.** `accept_team_admin_invitation` runs in one transaction. It requires a pending, unexpired invitation, a Clerk-verified email that matches it, and an inviter who is still a linked admin of the team. An email invitation is accepted only with the ID from Clerk metadata, when the new account first loads `/web/organizations`. An existing-account invitation is accepted only by the bound account. Acceptance creates a new `admin` member with the invitation name and a linked `web_admin_access` row (`approved_by` = the inviter's member, `policy_version = admin-invited-v1`). If the account is already linked to the team, it adds nothing and records the existing member. It never relinks another Clerk identity or merges with an existing Telegram member, even with the same name. An admin who also scouts through Telegram keeps the scout member; to connect Telegram to the admin member, that Telegram account must not already belong to another member of the team. Repeated or concurrent acceptance by the same account returns the same result.

**Pending invitations** show "Email sent", "Waiting to accept" or "Email not sent", with the expiry and inviter. Resend (email invitations only) closes the invitation as `superseded`, creates a new one with a new ID and 7 days, revokes the old Clerk invitation and sends a new one. The earlier link and ID stop working. The original inviter and attestation carry over. If the resend email fails, the new invitation shows "Email not sent". Cancel closes the record first, then revokes the Clerk invitation. Expired invitations close when the team's list loads or when someone tries to accept them. Cancelled, expired, superseded and accepted invitations cannot grant access. Revoking or demoting the inviter blocks their pending invitations.

**Privacy.** The email is kept only while the invitation is pending. Accepted, cancelled, superseded and expired invitations keep the name, team, inviter and dates as the approval record.

**Database access.** The runtime role has no table privileges on `team_admin_invitation`. It calls only the `SECURITY DEFINER` functions in `20261109060000_team_admin_invitations.ts`, which the migration grants to `ai_scouting_backend`. The functions must be owned by the migration role, which bypasses row-level security.

### Deployment

1. Merge to `main`. The `Production readiness` workflow applies migration `20261109060000_team_admin_invitations` with the owner connection and checks generated types. Railway deploys the backend after CI. The migration only adds a table and functions, so the previous backend keeps working during rollout.
2. Deploy the web app on Vercel.
3. No new environment variables. Invitations need `CLERK_SECRET_KEY` on the backend, and `WEB_ORIGINS` or `WEB_INVITATION_REDIRECT_URL` for the `/sign-up` redirect. Without Clerk, the invite, resend and accept routes return 503.

### Production smoke test

Use team 1241 and two test addresses you control.

1. As a team 1241 admin, open the workspace. The Administrators section lists you with "You".
2. Invite a person with no account. Confirm "Invitation email sent", an "Email sent" row and the Clerk email. Accept it in a private window. The new account lands on team 1241 and the section lists the new admin. The new account has no Operator item.
3. Invite an address that already has an account, for example an admin of another test team. Confirm "Waiting to accept" and that no email arrives. Sign in as that account: `/admin` shows the invitation; "Accept and open team" opens team 1241, and team selection now lists both teams.
4. Invite a third address, then Resend: the first email's link no longer works. Cancel it: the second link no longer works.
5. Try to invite an existing admin of the team: the dialog says they are already an administrator.
6. Remove the test admins with the revoke command above, and delete the test Clerk accounts.

Validation covers route authorization, input validation, Clerk delivery failure, resend and cancel ordering, and, against disposable Postgres, tenant isolation, forged team IDs, new and existing accounts, other teams' admins, operators, existing links, Telegram members, concurrent acceptance, expiry, cancellation, resend and inviter revocation. The UI was checked with fixture data at desktop and phone widths, with keyboard focus in the invite dialog. A live Clerk invitation was not tested end to end.

## Operator team directory

Issue #41 gives platform operators a view of every registered team at `/operator/teams` ("All teams" in the operator navigation). From it, operators can revoke any team's API key and remove any team administrator. Operators do not need to be members of a team, and opening a team never adds them to it. Pending and rejected access applications stay on `/operator`; this list shows only organizations.

**List.** Teams are ordered by team number, 25 to a page, with Previous and Next links. Search matches the start of the team number or any part of the name, case-insensitive; `%` and `_` match literally. Each row shows the team number, name, registration date, admin count, signed-in web admin count and active key count. A "No signed-in admin" badge marks teams with no linked web admin, and a badge counts open admin invitations.

**Team detail.** `/operator/teams/<organization>` shows:

- **Administrators:** every `admin` member, with "Signed in" (adult approval linked to an account), "Not signed in yet" (approved, not linked) or "No web access" (an admin member with no web approval). Open, unexpired admin invitations follow with name, inviter, expiry and the same status labels as the team's own list. Operator views never show invitee emails or Clerk account IDs, and reading the list does not close expired invitations.
- **API keys:** active keys first, then up to 50 revoked keys, with name, start, creation date, rate limit and status. Active values are masked. Show or Copy calls `POST /web/operator/teams/<organization>/api-keys/<key>/reveal` for that one key. Hide drops the value from the page. Revoked keys say their value was erased; there is nothing to recover. Operators cannot create keys.

**Revoking a key.** Revoke opens a confirmation dialog, then calls `POST /web/operator/teams/<organization>/api-keys/<key>/revoke`. In one transaction, `lock_operator_api_key` locks the active key, the backend deletes it in Unkey, and `complete_operator_api_key_revoke` marks it revoked, erases the stored value and records the operator in `revoked_by_operator`. If Unkey fails, the transaction rolls back, the key stays active and the operator sees a 502 with a retry message. Revoking a key that is already revoked succeeds without calling Unkey. The team's admins are not notified.

**Removing an administrator.** Remove opens a confirmation dialog, then calls `POST /web/operator/teams/<organization>/administrators/<member>/remove`. `remove_operator_team_admin` deletes the member's `web_admin_access` row, changes the member's role from `admin` to `scout`, and cancels the pending admin invitations they sent, in one transaction. The member row, Telegram identity and scouting history stay. The backend then revokes the cancelled invitations in Clerk; a failed Clerk call leaves only a link that cannot be accepted. The removed person loses web access and admin rights on their next request. Operators can remove the last administrator, and admins with no web approval. To restore someone, another admin of the team invites them again, or an owner uses the setup commands.

**Audit.** Each revoke and removal adds a row to `operator_team_action` with the operator's Clerk ID, the team, the action and the key or member ID. The runtime role has no privileges on that table.

**Secrets.** The list and detail responses never contain key values or ciphertext. The reveal route is POST only, returns `Cache-Control: private, no-store` like every operator route, and is called from a server action, so the value is not in a URL, page payload, shared cache or browser history. The backend does not log the value, the ciphertext or decryption errors. A revoked key returns 409, an unknown key or a key from another team returns 404. If API keys are not configured, or the stored value cannot be decrypted (for example after `API_KEY_ENCRYPTION_KEY` changed), the route returns 503 with a clear message.

**Authorization.** Every request passes the operator route check (verified Clerk session and a current `platform_operator` row), and each database function rechecks the operator with `is_platform_operator`. Removing an operator blocks their next request. Team admins and other accounts get 403 from the routes, and the functions return no rows or `forbidden`. Team-admin key and administrator endpoints are unchanged and remain tenant-scoped.

**Database access.** Migration `20261109080000_operator_team_changes.ts` adds `lock_operator_api_key`, `complete_operator_api_key_revoke`, `remove_operator_team_admin`, the `operator_team_action` table and the `api_key.revoked_by_operator` column. Migration `20261109070000_operator_team_directory.ts` adds `SECURITY DEFINER` functions (`list_operator_teams`, `operator_team`, `list_operator_team_admins`, `list_operator_team_admin_invitations`, `list_operator_api_keys`, `reveal_operator_api_key`) and grants only those to `ai_scouting_backend`. The runtime role gets no new table privileges, and `is_platform_operator` is not granted. The functions must be owned by the migration role, which bypasses row-level security. Page size is capped at 50 in the database.

### Deployment

1. Merge to `main`. The `Production readiness` workflow applies migrations `20261109070000_operator_team_directory` and `20261109080000_operator_team_changes` and checks generated types. They add functions, one table and one nullable column, so the previous backend keeps working during rollout.
2. Deploy the web app on Vercel.
3. No new environment variables. Key reveal uses the existing `API_KEY_ENCRYPTION_KEY`, and revoke uses the existing Unkey settings. Without them, reveal and revoke return 503.

### Production smoke test

1. As an operator, open All teams. Confirm team 1241 is listed with its admin and key counts, and that search by `1241` and by part of the name finds it.
2. Open team 1241. Confirm admin statuses match the team's own Administrators section, and that no emails appear.
3. Select Show on an active key and compare its start with the team workspace. Select Hide, then Copy, and paste to confirm. A revoked key has no Show or Copy.
4. Have a team 1241 admin create a test key. Revoke it from the operator view. Confirm it shows as revoked, it is gone from the team workspace, and a data API request with it fails.
5. Have a team 1241 admin invite a test administrator who accepts. Remove that administrator from the operator view. Confirm they can no longer open the team, and that the team's other admins are unaffected.
6. Sign in as a team 1241 admin who is not an operator. `/operator/teams` returns the not-found page.

Validation covers route authorization, search and paging input, reveal outcomes and decryption failure, revoke and remove outcomes including provider and Clerk failures, and, against disposable Postgres, revoke ordering and rollback, admin removal (demotion, kept identity, cancelled invitations, last admin, audit rows), directory completeness, teams with no admins or keys, search, paging bounds, admin web-access status, invitation privacy, active and revoked keys, cross-team key isolation, operator revocation, ordinary-admin denial and runtime-role privileges. The UI was checked with fixture data from the real backend routes at desktop and phone widths. Live Clerk sign-in was not used.

## Scouting specifications (#46)

Team admins create, publish and assign scouting contracts through `/web/organizations/<organization>/...`. The contract format is in the [scouting contract](scouting-contract.md). The builder UI is described [below](#specification-builder-47). Every call rechecks that the Clerk session is a linked admin of the team (`webAdminMember`). Telegram does not need to be linked. A team the account does not administer gets the same 404 as one that does not exist. The backend never trusts a supplied member ID.

| Method and path                                             | Purpose                                                                                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET specifications?season=&kind=`                          | Open drafts and publications, with the events each publication is assigned to                                                                             |
| `GET specifications/publications/<season>/<kind>/<version>` | One publication, read-only. Format 1 publications come back in the current format.                                                                        |
| `POST specifications/drafts`                                | Create a draft: `{ season, kind, name, source }`. `source` is `{ type: "blank" }`, `{ type: "publication", season, version }` or `{ type: "draft", id }`. |
| `GET specifications/drafts/<draft>`                         | Load a draft with its validation issues                                                                                                                   |
| `PUT specifications/drafts/<draft>`                         | Save `{ revision, name, document: { description, questions } }`                                                                                           |
| `DELETE specifications/drafts/<draft>`                      | Delete an unpublished draft                                                                                                                               |
| `POST specifications/drafts/<draft>/publish`                | Publish `{ revision }`                                                                                                                                    |
| `GET specifications/events`                                 | Every current event of the team with its match, pit and general assignments, newest first                                                                 |
| `GET events/<event>/specifications`                         | Current match, pit and general assignment for an event                                                                                                    |
| `PUT events/<event>/specifications/<kind>`                  | Assign `{ version }`, or `{ version: null }` to clear pit or general                                                                                      |

**Drafts.** A draft belongs to one team, season and kind. A blank draft starts with the protected identity questions for its kind. Copying a publication or a draft keeps the kind; the season can change. Save accepts incomplete content up to 256 KB and returns `issues`, the same path-addressable list that publication uses. The server sets `formatVersion`, `kind` and `version`; the client sends only the description and questions.

**Stale saves.** Each save sends the `revision` it loaded and gets the next one back. If someone else saved first, the response is HTTP 409 with the stored draft. Nothing is overwritten, so the editor keeps the author's changes and can offer a merge or a reload.

**Publication.** Publish validates the complete contract and returns HTTP 422 with `issues` if it is not valid. A valid draft becomes an immutable publication with the next server-assigned version for its team, season and kind (`v1`, `v2`, ...). The draft is then locked, leaves the draft list and records its version. A retry of the same draft returns the existing version with `replayed: true` and HTTP 200; it never creates a second version. Publishing an older revision gets HTTP 409. To change a publication, create a draft from it and publish a new version. Publication does not assign the version to any event.

**Assignment.** Assignment chooses the publication new sessions of a kind use at one event. The publication must have the event's season and the same kind (`season_mismatch` or `publication_not_found` otherwise).

- **Match** keeps the existing selection, `event.specification_version`, so Telegram event activation and intake are unchanged. Match always has a publication and cannot be cleared. Until #48 connects custom extraction, match accepts format 1 publications only (`unsupported_by_intake`).
- **Pit and general** use `event_specification_assignment`, one row per event and kind. They can be cleared. Intake for pit and general is #48.

Sessions pin their publication at intake. A new assignment affects only new sessions. Open sessions, follow-ups and recorded observations keep their publication, and nothing is re-extracted.

**Deployment.** Apply migration `20261110000000_specification_drafts` before deploying the backend, then run `pnpm db:sync` locally. It adds `specification_draft`, `event_specification_assignment` and three nullable columns on `published_specification` (`name`, `published_by`, `source_draft_id`). Existing publications are not changed.

## Specification builder (#47)

Team admins build scouting specifications in the team workspace at `/admin/<organization>/specifications`, without editing JSON. The team navigation row links to it ("Scouting specifications"), and the workspace has a summary card with the draft and publication counts. Each page rechecks team access, as the workspace does.

**List.** Specifications are grouped by season, then by kind (match, pit, general). Drafts show a Draft badge, the last edit and the copy source, with "Continue editing" and "Delete draft" (confirmation dialog). Publications show their version, name, publication date and the events whose new sessions use them. "New specification" opens a dialog for season, name, kind and the starting point:

- **Example questions:** the worked example from `packages/scouting/src/examples` for the kind. The server action creates a blank draft, then saves the example questions into it.
- **Identity questions only:** the blank draft from the API.
- **A published version:** a copy of any publication of the same kind, from any season.

**Editor.** `/specifications/drafts/<draft>` shows the questions in the order scouts are asked. Each row leads with the follow-up question, then the label, code, answer summary, base requirement and a plain-language sentence for each rule ("Asked only when Can climb is Yes"). A gutter to the left of the rows draws a line from each question to the questions whose rules read its answer; the selected question's lines are in the primary colour. One question opens at a time, in place, with:

- Move up, Move down, Duplicate and Remove (confirmation dialog that names the questions whose rules use it). Reordering uses buttons only and is announced to screen readers.
- Label, code, follow-up question, extraction guidance, answer type and the base requirement. A new question's code follows its label until the admin edits the code. Renaming a code updates the rules in the draft that use it.
- Answer settings: whole-number or decimal format with minimum and maximum, the longest text answer, and option lists with label, code, reorder and remove. Multiple choice adds the fewest and most selections.
- Conditions: each rule has an effect (ask only when, do not ask when, make required when, make optional when), one or more conditions, and "all" or "any" when there are several. A condition picks another question that is not free text, a comparison that fits its type, and a value (yes/no, a number, one option, or several options for "is one of"). Only effects that can apply are offered; identity questions offer none that would hide them or make required identity optional. A stored rule with nested groups is kept and shown as such, and can only be removed.
- Identity: a disclosure explains the identity questions for the kind. Identity rows have a navy Identity badge, a fixed code and answer type, and required identity cannot be removed or made optional. Missing optional identity questions can be added back.

**Validation.** The editor checks the draft as the admin types, with the shared validator from `packages/scouting` and plain-language messages for each field: missing text, code format, duplicate codes and labels, number bounds, option counts, missing or deleted rule dependencies, incompatible comparisons, redundant rules, identity protection and rule loops. Messages appear under the field and in a "N problems to fix before publishing" summary whose items go to the field. Drafts save with problems; publishing needs none.

**Saving.** Edits save automatically 1.5 seconds after the last change. The status bar at the bottom shows Saved (with the time), Unsaved changes, Saving, Not saved (with the reason and Try again) or "Not saved: edited elsewhere". Values that do not validate are saved as typed, so nothing is lost. If another admin saved first (HTTP 409), autosave stops and the page offers "Keep my version" (saves over theirs) or "Load their version". The browser warns before leaving with unsaved changes. If the draft was published or deleted elsewhere, the editor becomes read-only and says so.

**Publishing.** "Review and publish" lists the remaining problems, or shows the season, kind and next version (computed from the existing publications; the server assigns the actual version) and says that publishing changes no event. After publication the browser goes to the read-only publication page.

**Publication page.** `/specifications/publications/<season>/<kind>/<version>` shows the questions in the same outline, read-only, with "Create editable draft" (copies it into a new draft for a chosen season). The Events card lists the team's current events in that season. "Use for new sessions" and, for pit and general, "Stop using" open a dialog that says new sessions use the version and open sessions keep theirs. Until custom extraction is connected (#48), the card explains that match scouting cannot use custom questions and offers no match assignment for format 2 versions.

The web app imports `@ai-scouting/scouting` (TypeScript source, through `transpilePackages`) for the validator, types and examples, so the browser and the server use the same rules.
