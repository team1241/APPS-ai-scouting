import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { authConfigured } from "@/lib/auth-config";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
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
      <SiteHeader authEnabled={authConfigured()} />
      {children}
      <footer className="mx-auto flex max-w-5xl justify-end px-4 py-6 text-sm text-muted-foreground sm:px-6">
        <Link
          href="/privacy"
          className="inline-flex min-h-11 items-center rounded-md px-3 underline underline-offset-4 hover:text-foreground"
        >
          Privacy
        </Link>
      </footer>
    </>
  );
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        {authConfigured() ? (
          <ClerkProvider
            appearance={{ variables: { fontFamily: "var(--font-archivo), Arial, sans-serif" } }}
            telemetry={false}
            signInUrl="/sign-in"
            signInFallbackRedirectUrl="/admin"
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
