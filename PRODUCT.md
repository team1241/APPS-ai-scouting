# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Scope

This root product record describes the administration web app in `apps/web`. The wider scouting system is documented in `docs/system-specification.md`.

## Users

Approved adult administrators of Canadian FRC teams manage their team's integrations. High-school-age scouts continue submitting observations through Telegram.

## Product Purpose

Provide a clear, organization-scoped administration app, beginning with sign-in, organization selection and later API-key management. Existing backend memberships and roles remain authoritative.

## Operating Context

Administrators use laptops and phones during busy events. They sign in through Clerk, select an approved organization and enter its workspace. Telegram remains the scouting collection interface.

## Capabilities and Constraints

- Public adults can request team access through `/request-access`. A team with an earlier application or an existing organization cannot apply again. Submissions grant no membership or account until a platform operator approves them.
- Platform operators review applications at `/operator`, reached from the Operator item in the main navigation. Operators without a team land there after sign-in. Approval creates the organization, its first admin member and the adult web-admin approval, then sends a Clerk invitation. The invited account links to the new team on first sign-in. Operators add and remove other operators at `/operator/operators`, and invite people without an account by email. Invited operators get no team.
- Current surfaces include the app shell, sign-in, organization selection, organization workspace and privacy notice, with loading, error, empty and denied-access states.
- Access requires explicit adult-admin approval and account linking. Clerk authentication does not grant membership; the backend determines current memberships and permissions.
- Preserve tenant isolation and privacy boundaries. Do not add product analytics or session replay.
- Team admins invite other adult administrators to their team from the Administrators section of the team workspace (#40). The inviter enters a name and email and attests that the person is an adult authorized to administer the team. A person without an account gets a Clerk invitation email; a person with an account accepts from team selection. Acceptance creates a new admin member and the linked adult approval. Pending invitations grant nothing, expire after 7 days and can be resent or cancelled. Team admin invitations never grant platform-operator access. Team admins cannot remove admins or edit roles; platform operators can remove admins (#41).
- Team admins manage read-only organization API keys in the team workspace (#21): create named keys, view and copy any key at any time, and revoke keys. Keys belong to the team, not the admin who created them.
- Platform operators see every registered team at `/operator/teams` (#41): team number, name, registration date, admins with their web-access status, open admin invitations (without emails) and API keys. Operators can show and copy one active key value at a time, revoke any key, and remove any administrator. Removal demotes the member to scout and ends their web access; it keeps their scouting history. These are operator-only. They never add the operator to a team, and team-admin access stays tenant-scoped. Creating keys, editing teams and adding admins from this view are out of scope.
- Do not add scouting-data browsing or editing.

## Brand Personality

Straightforward, calm, precise. Admin pages use a simple light interface with a restrained team accent. The public entrance (home and request access) has more character, taken from the Theory6 Apps badge.

Keep the administration interface focused on administration. Do not include scouting-process explanations or Telegram reminders in the home page, navigation or footer.

## Anti-references

Avoid marketing landing pages, ornamental dashboards, and analytics or scouting-data browsing unrelated to the current administration task.

## Design Principles

- Make the selected team and access scope clear. Operator views across teams say so.
- Require explicit approval before administration access.
- Show actionable empty and unavailable states.
- Collect only what is needed for authentication and authorization.

## Accessibility & Inclusion

Use semantic HTML, visible keyboard focus, labeled controls, readable contrast, responsive layouts and reduced-motion support. The audience includes administrators working on laptops and phones during busy events.

Verify phone and desktop layouts, keyboard navigation, long organization names and useful interaction feedback. Keep access scope and recovery actions understandable in unavailable, empty and denied-access states.

## Evidence on Hand

- `docs/web-app.md`: implemented authentication, approval/linking, local setup and verification history.
- `docs/privacy.md` and `docs/privacy-notice.md`: privacy boundaries and notice content.
- `apps/web/src/app`: implemented administration routes and state handling.
- `DESIGN.md`: incumbent light interface and shared component guidance.
