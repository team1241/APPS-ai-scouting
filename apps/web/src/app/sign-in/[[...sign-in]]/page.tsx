import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { displayHeading, PublicBand } from "@/components/public-band";
import { authConfigured } from "@/lib/auth-config";
import { authCardAppearance } from "@/lib/clerk-appearance";

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
          <SignIn forceRedirectUrl="/admin" appearance={authCardAppearance} />
        </Suspense>
      </div>
    </main>
  );
}
