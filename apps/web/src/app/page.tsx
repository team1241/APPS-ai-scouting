import { ArrowRight, ChevronRight } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { displayHeading, PublicBand } from "@/components/public-band";

export default function Home() {
  return (
    <main id="main" className="flex flex-1 flex-col">
      <PublicBand
        className="flex flex-1 flex-col pt-12 sm:pt-20"
        footer={
          <div className="mt-12 grid gap-x-8 border-t border-white/15 py-4 text-sm text-bumper-ink sm:mt-20 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
            <p className="flex min-h-11 items-center">For approved adult administrators.</p>
            <details className="group">
              <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-full font-semibold text-white [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-sky transition-transform group-open:rotate-90 motion-reduce:transition-none"
                />
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
            className={`${displayHeading} text-[clamp(2.25rem,11vw,3rem)] sm:text-7xl lg:text-8xl`}
          >
            Team <span className="text-sky">administration</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-bumper-ink">Sign in to choose your team.</p>
          <div className="mt-8 flex max-w-md flex-col gap-3 sm:flex-row sm:items-center">
            <LinkButton
              href="/sign-in"
              size="lg"
              className="w-full bg-white px-6 text-bumper-deep hover:bg-bumper-ink sm:w-auto"
            >
              Sign in
              <ArrowRight aria-hidden="true" className="size-5" />
            </LinkButton>
            <LinkButton
              href="/request-access"
              variant="outline"
              size="lg"
              className="w-full border-white/50 px-6 text-white hover:bg-white/10 sm:w-auto"
            >
              Request access
            </LinkButton>
          </div>
        </section>
      </PublicBand>
    </main>
  );
}
