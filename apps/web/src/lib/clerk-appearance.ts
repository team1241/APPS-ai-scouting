// Shared Clerk theme for the sign-in and invitation sign-up cards.
// Clerk computes shades from these, so they are hex copies of --bumper and --foreground.
const bumper = "#1c4cc8";
const foreground = "#131a2b";

export const authCardAppearance = {
  variables: {
    colorPrimary: bumper,
    colorForeground: foreground,
    colorRing: bumper,
    borderRadius: "0.75rem",
    fontFamily: "var(--font-mona), system-ui, sans-serif",
    fontSize: "1rem",
  },
  elements: {
    rootBox: "w-full max-w-md",
    cardBox:
      "w-full max-w-none rounded-2xl border-0 shadow-[0_2px_6px_oklch(0.3_0.08_264/0.08),0_28px_56px_-24px_oklch(0.3_0.12_264/0.45)]",
    card: "rounded-2xl px-5 py-8 shadow-none sm:px-8",
    header: "hidden!",
    socialButtonsBlockButton: "min-h-11 rounded-full!",
    formFieldInput: "min-h-11",
    // Clerk gives "Last used" a fixed height but scales its text from the 1rem
    // base, so the text outgrows the pill. Size it directly; keep Clerk's position.
    lastAuthenticationStrategyBadge:
      "h-5! rounded-full! border-0! bg-sky! bg-none! px-2! text-xs! leading-5! font-semibold! text-bumper-deep! shadow-[0_0_0_2px_white]!",
    formButtonPrimary: `min-h-12 rounded-full! bg-bumper! bg-none! text-base font-semibold shadow-none! hover:bg-bumper-deep! after:hidden!`,
  },
};
