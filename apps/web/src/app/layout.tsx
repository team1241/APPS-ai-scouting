import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { authConfigured } from "@/lib/auth-config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Scouting administration", template: "%s · Scouting" },
  description: "Team access and integration administration.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const content = (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:bg-white focus:p-4">
        Skip to content
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
          <Link href="/" className="font-semibold tracking-tight">
            Scouting <span className="font-normal text-muted-foreground">/ Administration</span>
          </Link>
          <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground">
            Privacy
          </Link>
        </div>
      </header>
      {children}
      <footer className="mx-auto max-w-5xl px-6 py-8 text-sm text-muted-foreground">
        Scouting collection continues in Telegram.
      </footer>
    </>
  );
  return (
    <html lang="en">
      <body>
        {authConfigured() ? (
          <ClerkProvider telemetry={false} signInUrl="/sign-in" signInFallbackRedirectUrl="/admin">
            {content}
          </ClerkProvider>
        ) : (
          content
        )}
      </body>
    </html>
  );
}
