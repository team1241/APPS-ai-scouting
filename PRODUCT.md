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
- Platform operators review applications at `/operator`. Approval creates the organization, its first admin member and the adult web-admin approval, then sends a Clerk invitation. The invited account links to the new team on first sign-in. Operators add and remove other operators at `/operator/operators`, and invite people without an account by email. Invited operators get no team.
- Current surfaces include the app shell, sign-in, organization selection, organization workspace and privacy notice, with loading, error, empty and denied-access states.
- Access requires explicit adult-admin approval and account linking. Clerk authentication does not grant membership; the backend determines current memberships and permissions.
- Preserve tenant isolation and privacy boundaries. Do not add product analytics or session replay.
- Issue #28 refines the existing Next.js and shadcn/ui administration app. It does not add API-key management, scouting-data browsing or editing, authentication-provider migration, or backend features. API-key management remains future work.

## Brand Personality

Straightforward, calm, precise. Admin pages use a simple light interface with a restrained team accent. The public entrance (home and request access) has more character, taken from the Theory6 Apps badge.

Keep the administration interface focused on administration. Do not include scouting-process explanations or Telegram reminders in the home page, navigation or footer.

## Anti-references

Avoid marketing landing pages, ornamental dashboards, and analytics or scouting-data browsing unrelated to the current administration task.

## Design Principles

- Make the selected team and access scope clear.
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
