import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Martian_Mono, Mona_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { OperatorEntry } from "@/components/operator-entry";
import { SiteHeader } from "@/components/site-header";
import { authConfigured } from "@/lib/auth-config";
import "./globals.css";

// Mona Sans carries UI text and, at width 125 and black weight, the bumper numerals.
const mona = Mona_Sans({
  subsets: ["latin"],
  display: "swap",
  axes: ["wdth"],
  variable: "--font-mona",
});

// Martian Mono is for values people copy or compare: keys, codes and versions.
const martian = Martian_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-martian",
});

export const metadata: Metadata = {
  title: { default: "Scouting administration", template: "%s · Scouting" },
  description: "Team access and integration administration.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const content = (
    <>
      <a
        href="#main"
        className="sr-only rounded-full focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:shadow-lg"
      >
        Skip to content
      </a>
      <SiteHeader
        authEnabled={authConfigured()}
        operatorEntry={
          authConfigured() ? (
            <Suspense fallback={null}>
              <OperatorEntry />
            </Suspense>
          ) : null
        }
      />
      {children}
      <footer className="bumper-field mt-auto bg-bumper-deep text-sm text-bumper-ink">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="font-display text-white">Theory6 Apps</span>
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center rounded-full px-3 font-medium hover:bg-white/10 hover:text-white"
          >
            Privacy
          </Link>
        </div>
      </footer>
    </>
  );
  return (
    <html lang="en" className={`light ${mona.variable} ${martian.variable}`} data-theme="light">
      <body className="flex min-h-svh flex-col">
        {authConfigured() ? (
          <ClerkProvider
            appearance={{ variables: { fontFamily: "var(--font-mona), system-ui, sans-serif" } }}
            telemetry={false}
            signInUrl="/sign-in"
            signInFallbackRedirectUrl="/admin"
            signUpUrl="/sign-up"
            signUpFallbackRedirectUrl="/admin"
            afterSignOutUrl="/"
          >
            {content}
          </ClerkProvider>
        ) : (
          content
        )}
      </body>
    </html>
  );
}
