---

version: 1
slug: "in-organizationid-specifications-page-tsx-d6f4e803"
primary_target: "apps/web/src/app/admin/[organizationId]/specifications/page.tsx"
related_targets: ["apps/web/src/app/admin/[organizationId]/specifications/drafts/[draftId]/page.tsx"]
---

# Scouting specification builder

Scope: team workspace routes `/admin/<team>/specifications` (list), `/specifications/drafts/<id>` (editor) and `/specifications/publications/<season>/<kind>/<version>` (read-only). Mode: Operate.

Audience and job: approved adult team admins build match, pit and general scouting contracts without JSON, on laptops and phones at events. Constraints: existing light admin system, ConfirmDialog for destructive confirmations, no drag-only interactions, autosave.

## Direction contract

THESIS: The contract is an ordered conversation with a scout. Each row leads with the follow-up a scout would read, and rules are drawn as lines between questions. Refuses the generic accordion form builder.
OWN-WORLD: The incumbent admin system: light ground, bordered white cards, navy PageHeading, primary blue for selection and actions, sky for rule lines, StatusBadge tones for save and validation state.
STORY: The admin sees which version is draft, published or assigned, opens a draft, reads the questions as scouts will meet them, edits one at a time, fixes listed problems and publishes with clear consequences.
FIRST VIEWPORT: Team row, then the draft title and description. One wide column (about 940px): prompt-first question blocks, each with number, the follow-up in large navy text, then label, code, answer summary and a rule sentence; a left gutter draws sky lines from each question to the questions whose rules read it. The selected block opens in place into its fields (label, code, follow-up, guidance, type and constraints, conditions). A sticky bottom bar holds save status, problem count, Add question and Review and publish. Phones keep the same column with the gutter narrowed.
FORM: Fusion of the outline-with-rule-gutter and scout-conversation candidates, chosen after a steered re-roll (lead of the second hand). seed:b3cd8dea8e0e26d4
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
