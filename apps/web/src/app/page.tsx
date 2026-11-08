import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authConfigured } from "@/lib/auth-config";

export default function Home() {
  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <section
        id="administrator-access"
        tabIndex={-1}
        aria-labelledby="home-title"
        className="max-w-3xl scroll-mt-6"
      >
        <div className="space-y-6">
          <h1
            id="home-title"
            className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-6xl"
          >
            Team administration
          </h1>
          <p className="max-w-md text-lg text-muted-foreground">Sign in to choose your team.</p>
        </div>
        <div className="mt-8 max-w-md">
          {authConfigured() ? (
            <Button
              asChild
              className="min-h-12 w-full gap-3 whitespace-normal px-6 text-base shadow-none focus-visible:ring-2 focus-visible:ring-offset-4 sm:w-auto"
            >
              <Link href="/sign-in">
                Sign in
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </Button>
          ) : (
            <p role="status" className="rounded-md bg-muted p-4 text-sm">
              Administration is being set up. Contact your team lead for access.
            </p>
          )}
          <p className="mt-4 text-sm text-muted-foreground">For approved adult administrators.</p>
          <details className="mt-6 border-t pt-2 text-sm text-muted-foreground">
            <summary className="min-h-11 cursor-pointer content-center rounded-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              Access requirements
            </summary>
            <p className="pb-2 pt-1">
              For Canadian teams. You must be at least 18 and the age of majority where you live.
              Your team’s responsible adult lead must approve your access before you sign in.
            </p>
          </details>
        </div>
      </section>
    </main>
  );
}
