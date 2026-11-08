import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authConfigured } from "@/lib/auth-config";

export default function SignInPage() {
  if (!authConfigured()) redirect("/");
  return (
    <main id="main" className="mx-auto max-w-md space-y-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with the account approved by your team. New access is arranged by your adult team
          lead.
        </p>
      </div>
      <Suspense fallback={<p>Loading sign-in…</p>}>
        <SignIn forceRedirectUrl="/admin" />
      </Suspense>
    </main>
  );
}
