import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { OperatorEntry } from "@/components/operator-entry";
import { SiteHeader } from "@/components/site-header";
import { authConfigured } from "@/lib/auth-config";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  axes: ["wdth"],
  variable: "--font-archivo",
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
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-white focus:p-4"
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
      <footer className="public-band mt-auto border-t border-sky/15 bg-navy text-sm text-sky-soft">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="px-2 font-extrabold font-stretch-125% text-white">Theory6 Apps</span>
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center rounded-md px-3 underline decoration-sky/50 underline-offset-4 hover:text-white"
          >
            Privacy
          </Link>
        </div>
      </footer>
    </>
  );
  return (
    <html lang="en" className={archivo.variable}>
      <body className="flex min-h-svh flex-col">
        {authConfigured() ? (
          <ClerkProvider
            appearance={{ variables: { fontFamily: "var(--font-archivo), Arial, sans-serif" } }}
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
