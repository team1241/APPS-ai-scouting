import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AccessApplicationForm } from "@/components/access-application-form";
import { displayHeading, PublicBand } from "@/components/public-band";
import { Button } from "@/components/ui/button";
import { authConfigured } from "@/lib/auth-config";

export const metadata: Metadata = { title: "Request access" };

export default async function RequestAccessPage() {
  await connection();
  const signedIn = authConfigured() ? Boolean((await auth()).userId) : false;
  return (
    <main id="main">
      <PublicBand badge className="pt-12 pb-28 sm:pt-16 sm:pb-32">
        <h1 className={`${displayHeading} text-4xl sm:text-6xl`}>
          Request <span className="text-sky">access</span>
        </h1>
      </PublicBand>
      <div className="relative z-10 mx-auto -mt-20 max-w-5xl px-4 pb-12 sm:px-6">
        <div className="max-w-xl rounded-xl bg-card p-5 shadow-[0_24px_48px_-24px_oklch(0.2_0.07_264/0.45)] sm:p-8">
          {signedIn ? (
            <>
              <p className="text-muted-foreground">
                You’re already signed in. Go to your teams to manage your existing access.
              </p>
              <Button asChild className="mt-6 min-h-11">
                <Link href="/admin">Go to teams</Link>
              </Button>
            </>
          ) : (
            <AccessApplicationForm requestId={randomUUID()} />
          )}
        </div>
      </div>
    </main>
  );
}
