---

version: 1
slug: "apps-web-src-app-request-access-page-tsx"
primary_target: "apps/web/src/app/request-access/page.tsx"
related_targets: ["apps/web/src/components/access-application-form.tsx"]
---

# Public access application

Mode: Operate. Extend the established administration interface for signed-out adults requesting team access. Use a separate /request-access page, linked from home. Email and owner review UI are out of scope; submission grants no access.

## Direction contract

THESIS: One short application with a clear boundary between receipt and approval. No registration wizard or account provisioning.

OWN-WORLD: Navy entrance band from the Theory6 badge (see DESIGN.md Public entrance), expanded Archivo heading, white form card with navy submit, shadcn Field, Input, Select and Checkbox components managed by TanStack Form, existing header/footer, and 8px corners.

STORY: Explain review, collect the five requested details, and replace the form with a receipt after the database accepts the submission. Keep values on validation or service failure.

FIRST VIEWPORT: A heading in the navy band, with a single-column form card (max-width-xl, left-aligned) overlapping the band edge. Name and email precede team number and a shadcn role select; adult attestation and privacy context precede Submit application. Phone controls fill the available width. On home, the outlined Request access action is secondary to the filled Sign in action.

FORM: A precisely specified narrow form inside the existing world; seed: none (unavailable). The signature interaction is the form becoming a focused receipt after successful persistence, with no decorative animation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
