# Scouting administration

## Visual direction

Adult team leads use laptops in brightly lit event venues and phones between tasks. Two registers share one system. A navy frame (header, footer and the public entrance band) carries the character of the Theory6 Apps badge: navy, sky blue and circuit linework. Admin content inside the frame stays light and restrained, with clear grouping and a blue action accent. The colours come from the badge; they do not assert any FRC team's branding.

## Foundation

Next.js App Router with Tailwind CSS and locally owned shadcn/ui New York components. Archivo is the shared sans-serif for headings, body text, controls and Clerk components. Load the Latin variable font, with its width (`wdth`) axis, through `next/font/google` with swap display and metric-adjusted fallback; Next.js serves the font from the app rather than making browser requests to Google. Use regular weight for body copy and medium/semibold for controls. Display headings and wordmarks use extra-bold at width 125 (`font-stretch-125%`), shared through `displayHeading`. Semantic HTML and a compact typography scale remain the foundation. Colors use OKLCH CSS variables in `apps/web/src/app/globals.css`, including `--navy`, `--navy-raised`, `--sky` and `--sky-soft` for the frame. Text selection uses the sky tint.

## Components and layout

Buttons and cards live in `apps/web/src/components/ui`. Keep corners at 8–12px and reserve the accent for actions and selection. Field outlines use `--color-input` (light grey, slightly stronger than card borders); checkboxes use a stronger muted outline so the small box stays visible. Admin surfaces use borders, not decorative shadows. The one exception is a public card that overlaps the navy band (request form, Clerk sign-in): it uses a soft navy shadow and no border. Desktop content is centered; organization rows remain readable and clickable on phones. Error, denied-access, loading and empty states use plain actionable language. Loading states are skeletons that match the loaded page: heading and description bars, then the same bordered lists, fields and buttons, in the `--color-skeleton` tint. Each keeps a screen-reader-only status message, and the pulse runs only when reduced motion is off.

The public access application uses TanStack Form with Zod validation and shadcn Field, Input, Select and Checkbox components. The page heading leads directly into the form without introductory paragraphs. Controls have visible labels and focus, with full-width fields and a full-width primary action on phones. Validation uses inline FieldError messages and focuses the first invalid control; server failures add an actionable error summary; service failure preserves entered values. Pending submission disables the controls and names the operation. A successful submission replaces the form, inside the same card, with a receipt that distinguishes pending review from granted access.

## Accessibility

Visible keyboard focus, a skip link, semantic headings, labeled actions, reduced-motion-aware loading and text status alongside any visual state. The circuit traces' one-time draw-in is the only decorative motion, and it is off under reduced motion. Do not add other unnecessary motion, profile displays, analytics or session replay.

## Administration navigation

The header and footer are navy on every page and frame the light admin content. The header shows the supplied Theory6 Apps logo (`apps/web/src/assets/apps-logo.png`), clipped to its circle at 44px, with a "Theory6" wordmark (Archivo width 125) and a sky "Administration" label on wider screens. Together they are the home link, with an accessible name and visible focus. It returns signed-in users to team selection and signed-out users to the public entrance.

The header exposes labeled navigation: Home, and Teams when signed in. The current location has white text and a sky underline. Signed-out users see a quiet Request access link (hidden on phones and on the request page) and a sky Sign in button. While account state loads, show a short loading status. The footer shows the Theory6 Apps wordmark and the Privacy link. Do not leave the logo as the only usable header element. Omit scouting-process explanations and Telegram reminders from the ordinary administration interface.

Signed-in users have the Clerk profile button in the same header position across screens; account settings and sign-out live in its menu. This is the requested account control, not an additional profile display. Privacy remains available in the footer.

Inside a workspace, a secondary navigation row displays the current backend-authorized team number and name with an explicit Change team action only when the current backend response contains more than one authorized team. It uses the page's existing access result, never a Clerk organization claim or URL-derived label. Loading and denied/unavailable pages do not assert a selected team. Long names wrap, controls retain at least 44px hit areas, and narrow layouts can wrap the team action onto another line without a hamburger menu.

Team-selection lists clip hover backgrounds to their rounded container. Row focus outlines sit inside the row so keyboard focus remains visible within that clipping.

## Operator review

`/operator` is an admin surface in the light register. It is reached from a "Review applications" outline button on the team selection page, shown only to platform operators. The page has two bordered lists: "Waiting for review" (oldest first) and "Recently reviewed". Each row leads with the tabular team number and applicant name, then role, email and date in muted text.

A pending row has a team name field prefilled with "Team <number>" and a primary "Approve and invite" action on the same line on wider screens. Reject is a quiet destructive text button that opens a confirmation dialog (`ConfirmDialog`, built on the Radix alert dialog): a white 12px-radius panel over a navy scrim, a question title, one line on the consequence, a focused outline "Keep reviewing" action and a destructive "Reject application" action. Buttons stack on phones with the destructive action first. The dialog stays open while the action runs, shows any error inside it, and closes on success. Reviewed rows show their state in text: Invited, Signed in, Rejected, or "Invitation not sent" in the destructive colour with "Resend invitation". Controls keep 44px hit areas and stack to full width on phones. The destructive button variant uses `--color-destructive-foreground` for its label.

Operator pages share a white secondary navigation row ("Platform operator", then Applications and Operators) with the current page underlined in the primary colour. It lives in the operator layout, so it stays in place while the page below loads. The Operators page lists operators with who added them, marks the viewer "(you)" without a Remove action, and ends with a bordered add form (name and email side by side on wider screens). Remove still confirms in place. Open invitations appear between the operator list and the add form under "Invited", with the email, expiry and inviter, an outline Resend action and a quiet destructive Cancel invitation that opens the same confirmation dialog ("Keep invitation" / "Cancel invitation"). Expired or unsent invitations show their state in the destructive colour. The add button reads "Add or invite".

## Public entrance

The signed-out home page, `/sign-in` and `/request-access` share a navy entrance band (`PublicBand`, `apps/web/src/components/public-band.tsx`). Its character comes from the Theory6 Apps badge: navy (`--navy`), sky blue (`--sky`, `--sky-soft`), circuit-trace linework and the mascot badge. The admin pages keep the light interface.

- Headings use Archivo at width 125 and extra-bold weight, with the second word in sky blue. No gradient text.
- `CircuitTraces` is authored SVG geometry at low opacity. It draws in once on load and is static under reduced motion. On phones a mask keeps the traces away from text and actions.
- The badge is clipped to its own circle. The home page has no badge in the band; the header logo is enough. The sign-in and request pages show a small badge on wider screens only. The supplied logo has no transparency, so the circle clip trims the edge of the “6”; a transparent export would fix this.
- On the band, the primary action is sky blue with navy text; the secondary action is outlined in sky. Focus rings are sky blue with a navy offset.

Home: the band fills the space between header and footer. “Team administration” and “Sign in to choose your team.”, then Sign in and Request access, in one left-aligned column. A strip along the bottom of the band holds the approved-adult line and the native Access requirements disclosure. Sign in always shows, so every environment, including local worktrees, needs the Clerk keys in `apps/web/.env.local`. Do not add scouting-process copy or promotional claims.

Sign in: the band holds “Welcome back” and the one-line approval note. The Clerk SignIn card overlaps the band edge like the request form, themed through `appearance` (hex copies of navy and foreground, Archivo, navy flat primary button, 44px controls). Clerk's own header is hidden because the band carries the heading. The site header omits its Sign in button on this page.

Request access: the band holds only the heading. The form sits in a white card (12px radius, soft navy shadow, no border) that overlaps the band edge. The submit action is navy. The receipt replaces the form inside the same card with a sky check mark; do not nest a second card.
