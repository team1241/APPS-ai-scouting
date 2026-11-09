import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { displayHeading, PublicBand } from "@/components/public-band";
import { authConfigured } from "@/lib/auth-config";
import { authCardAppearance } from "@/lib/clerk-appearance";

// Invitation landing page. Sign-up is invite-only, so the first step needs the
// Clerk invitation ticket; later Clerk steps (such as verification) are sub-paths.
export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ "sign-up"?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!authConfigured()) redirect("/");
  const [{ "sign-up": step }, query] = await Promise.all([params, searchParams]);
  if (!step?.length && typeof query.__clerk_ticket !== "string") redirect("/sign-in");
  return (
    <main id="main">
      <PublicBand badge className="pt-12 pb-28 sm:pt-16 sm:pb-32">
        <h1 className={`${displayHeading} text-4xl sm:text-6xl`}>
          Accept your <span className="text-sky">invitation</span>
        </h1>
        <p className="mt-4 max-w-md text-sky-soft">
          Create your account with the email address that received the invitation.
        </p>
      </PublicBand>
      <div className="relative z-10 mx-auto -mt-20 max-w-5xl px-4 pb-12 sm:px-6">
        <Suspense
          fallback={
            <p className="max-w-md rounded-xl bg-card p-8 text-muted-foreground">
              Loading your invitation…
            </p>
          }
        >
          <SignUp forceRedirectUrl="/admin" signInUrl="/sign-in" appearance={authCardAppearance} />
        </Suspense>
      </div>
    </main>
  );
}
