// Shared Clerk theme for the sign-in and invitation sign-up cards.
// Clerk computes shades from these, so they are hex copies of --navy and --foreground.
const navy = "#061335";
const foreground = "#191d24";

export const authCardAppearance = {
  variables: {
    colorPrimary: navy,
    colorForeground: foreground,
    colorRing: navy,
    borderRadius: "0.5rem",
    fontFamily: "var(--font-archivo), Arial, sans-serif",
    fontSize: "1rem",
  },
  elements: {
    rootBox: "w-full max-w-md",
    cardBox:
      "w-full max-w-none rounded-xl border-0 shadow-[0_24px_48px_-24px_oklch(0.2_0.07_264/0.45)]",
    card: "rounded-xl px-5 py-8 shadow-none sm:px-8",
    header: "hidden!",
    socialButtonsBlockButton: "min-h-11",
    formFieldInput: "min-h-11",
    // Clerk gives "Last used" a fixed height but scales its text from the 1rem
    // base, so the text outgrows the pill. Size it directly; keep Clerk's position.
    lastAuthenticationStrategyBadge:
      "h-5! rounded-full! border-0! bg-sky-soft! bg-none! px-2! text-xs! leading-5! font-semibold! text-navy! shadow-[0_0_0_2px_white]!",
    formButtonPrimary:
      "min-h-12 bg-navy! bg-none! text-base font-semibold shadow-none! hover:bg-navy-raised! after:hidden!",
  },
};
