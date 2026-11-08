# Scouting administration

## Visual direction

Adult team leads use laptops in brightly lit event venues and phones between tasks. Use a light, restrained interface with clear grouping and a single blue action accent. The accent is a starting token, not an assertion of official team branding.

## Foundation

Next.js App Router with Tailwind CSS and locally owned shadcn/ui New York components. System sans-serif, semantic HTML and a compact typography scale. Colors use OKLCH CSS variables in `apps/web/src/app/globals.css`.

## Components and layout

Buttons and cards live in `apps/web/src/components/ui`. Keep corners at 8–12px, use borders rather than decorative shadows, and reserve the accent for actions and selection. Desktop content is centered; organization rows remain readable and clickable on phones. Error, denied-access, loading and empty states use plain actionable language.

## Accessibility

Visible keyboard focus, a skip link, semantic headings, labeled actions, reduced-motion-aware loading and text status alongside any visual state. Do not add unnecessary motion, profile displays, analytics or session replay.
