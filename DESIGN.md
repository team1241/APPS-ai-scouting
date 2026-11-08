# Scouting administration

## Visual direction

Adult team leads use laptops in brightly lit event venues and phones between tasks. Use a light, restrained interface with clear grouping and a single blue action accent. The accent is a starting token, not an assertion of official team branding.

## Foundation

Next.js App Router with Tailwind CSS and locally owned shadcn/ui New York components. Archivo is the shared sans-serif for headings, body text, controls and Clerk components. Load the Latin variable font through `next/font/google` with swap display and metric-adjusted fallback; Next.js serves the font from the app rather than making browser requests to Google. Use regular weight for body copy, medium/semibold for controls and bold for the home heading. Semantic HTML and a compact typography scale remain the foundation. Colors use OKLCH CSS variables in `apps/web/src/app/globals.css`.

## Components and layout

Buttons and cards live in `apps/web/src/components/ui`. Keep corners at 8–12px, use borders rather than decorative shadows, and reserve the accent for actions and selection. Desktop content is centered; organization rows remain readable and clickable on phones. Error, denied-access, loading and empty states use plain actionable language.

## Accessibility

Visible keyboard focus, a skip link, semantic headings, labeled actions, reduced-motion-aware loading and text status alongside any visual state. Do not add unnecessary motion, profile displays, analytics or session replay.

## Administration navigation

The supplied Theory6 Apps logo (`apps/web/src/assets/apps-logo.png`) is the header's home link, with an accessible name and visible focus. It returns signed-in users to team selection and signed-out users to the public entrance. Keep the artwork intact within a 44px area, with its natural aspect ratio. A quiet Administration label identifies the product on wider screens.

The header must expose labeled navigation: Home, and Teams when signed in, with the current location indicated. Show Sign in when signed out and authentication is available; while account state loads, show a short loading status. Without authentication configuration, Get access links to the visible administrator-access section. Do not leave the logo as the only usable header element. Omit scouting-process explanations and Telegram reminders from the ordinary administration interface.

Signed-in users have the Clerk profile button in the same header position across screens; account settings and sign-out live in its menu. This is the requested account control, not an additional profile display. Privacy remains available in the footer.

Inside a workspace, a secondary navigation row displays the current backend-authorized team number and name with an explicit Change team action only when the current backend response contains more than one authorized team. It uses the page's existing access result, never a Clerk organization claim or URL-derived label. Loading and denied/unavailable pages do not assert a selected team. Long names wrap, controls retain at least 44px hit areas, and narrow layouts can wrap the team action onto another line without a hamburger menu.

Team-selection lists clip hover backgrounds to their rounded container. Row focus outlines sit inside the row so keyboard focus remains visible within that clipping.

## Home access layout

The home page is a compact product entrance aligned with the header's content edge (`max-w-5xl`, 24px horizontal padding). It has no enclosing card. Use direct product copy: “Team administration”, followed by “Sign in to choose your team.” and a prominent Sign in action linking to Clerk's sign-in route. Set the Archivo heading in bold foreground text, at 36px on phones and 60px on wider screens, with balanced wrapping instead of a forced line break. Reserve the blue accent for the action.

Keep approved-adult eligibility visible in one short line. Put age, Canadian-team and team-lead approval details in a native Access requirements disclosure beneath it. The action and disclosure share a compact measure (`max-w-md`); the action fills that measure on phones and fits its label on larger screens. Preserve one reading path, the existing light palette and typography, and the footer privacy link. Do not add scouting-process copy or promotional feature claims.
