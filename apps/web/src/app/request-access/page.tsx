import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { connection } from "next/server";
import { AccessApplicationForm } from "@/components/access-application-form";
import { LinkButton } from "@/components/link-button";
import { displayHeading, overlapCard, PublicBand } from "@/components/public-band";
import { authConfigured } from "@/lib/auth-config";

export const metadata: Metadata = { title: "Request access" };

export default async function RequestAccessPage() {
  await connection();
  const signedIn = authConfigured() ? Boolean((await auth()).userId) : false;
  return (
    <main id="main">
      <PublicBand badge className="pt-12 pb-28 sm:pt-16 sm:pb-32">
        <h1 className={`${displayHeading} text-5xl sm:text-7xl`}>
          Request <span className="text-sky">access</span>
        </h1>
      </PublicBand>
      <div className="relative z-10 mx-auto -mt-20 max-w-6xl px-4 pb-12 sm:px-6">
        <div className={`max-w-xl p-5 sm:p-8 ${overlapCard}`}>
          {signedIn ? (
            <>
              <p className="text-muted">
                You’re already signed in. Go to your teams to manage your existing access.
              </p>
              <LinkButton href="/admin" className="mt-6">
                Go to teams
              </LinkButton>
            </>
          ) : (
            <AccessApplicationForm requestId={randomUUID()} />
          )}
        </div>
      </div>
    </main>
  );
}
