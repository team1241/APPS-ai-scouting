import Link from "next/link";
import { displayHeading, PublicBand } from "@/components/public-band";
import { Button } from "@/components/ui/button";

const bandFocus =
  "focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-4 focus-visible:ring-offset-navy";

export default function Home() {
  return (
    <main id="main" className="flex flex-1 flex-col">
      <PublicBand
        className="flex flex-1 flex-col pt-12 sm:pt-16"
        footer={
          <div className="mt-12 grid gap-x-8 border-t border-sky/20 py-4 text-sm text-sky-soft sm:mt-16 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
            <p className="flex min-h-11 items-center">For approved adult administrators.</p>
            <details className="group">
              <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-sm font-medium text-white [&::-webkit-details-marker]:hidden">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-4 text-sky transition-transform group-open:rotate-90 motion-reduce:transition-none"
                >
                  <path d="M6 3l5 5-5 5" />
                </svg>
                Access requirements
              </summary>
              <p className="max-w-xl pb-2 pl-6">
                For Canadian teams. You must be at least 18 and the age of majority where you live.
                Your team’s responsible adult lead must approve your access before you sign in.
              </p>
            </details>
          </div>
        }
      >
        <section
          id="administrator-access"
          tabIndex={-1}
          aria-labelledby="home-title"
          className="scroll-mt-6"
        >
          <h1
            id="home-title"
            className={`${displayHeading} text-[clamp(1.75rem,9.4vw,2.5rem)] sm:text-6xl lg:text-7xl`}
          >
            Team <span className="text-sky">administration</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-sky-soft">Sign in to choose your team.</p>
          <div className="mt-8 flex max-w-md flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              asChild
              className={`min-h-12 w-full gap-3 whitespace-normal bg-sky px-6 text-base font-semibold text-navy shadow-none hover:bg-sky-soft sm:w-auto ${bandFocus}`}
            >
              <Link href="/sign-in">
                Sign in
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className={`min-h-12 w-full border-sky/60 bg-transparent px-6 text-base text-white shadow-none hover:bg-white/10 hover:text-white sm:w-auto ${bandFocus}`}
            >
              <Link href="/request-access">Request access</Link>
            </Button>
          </div>
        </section>
      </PublicBand>
    </main>
  );
}
