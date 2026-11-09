import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { displayHeading, PublicBand } from "@/components/public-band";
import { authConfigured } from "@/lib/auth-config";

// Clerk computes shades from these, so they are hex copies of --navy and --foreground.
const navy = "#061335";
const foreground = "#191d24";

export default function SignInPage() {
  if (!authConfigured()) redirect("/");
  return (
    <main id="main">
      <PublicBand badge className="pt-12 pb-28 sm:pt-16 sm:pb-32">
        <h1 className={`${displayHeading} text-4xl sm:text-6xl`}>
          Welcome <span className="text-sky">back</span>
        </h1>
        <p className="mt-4 max-w-md text-sky-soft">
          Sign in with the account approved by your team. New access is arranged by your adult team
          lead.
        </p>
      </PublicBand>
      <div className="relative z-10 mx-auto -mt-20 max-w-5xl px-4 pb-12 sm:px-6">
        <Suspense
          fallback={
            <p className="max-w-md rounded-xl bg-card p-8 text-muted-foreground">
              Loading sign-in…
            </p>
          }
        >
          <SignIn
            forceRedirectUrl="/admin"
            appearance={{
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
                formButtonPrimary:
                  "min-h-12 bg-navy! bg-none! text-base font-semibold shadow-none! hover:bg-navy-raised! after:hidden!",
              },
            }}
          />
        </Suspense>
      </div>
    </main>
  );
}
