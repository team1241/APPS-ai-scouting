"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import logo from "@/assets/apps-logo.png";

function HeaderContent({ signedIn = false, account }: { signedIn?: boolean; account: ReactNode }) {
  const pathname = usePathname();
  const navigationClass =
    "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground aria-[current]:bg-accent aria-[current]:text-primary";
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:gap-x-6 sm:px-6">
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href={signedIn ? "/admin" : "/"}
            aria-label="Theory6 Apps home"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-accent"
          >
            <Image
              src={logo}
              alt=""
              width={44}
              height={43}
              sizes="44px"
              className="h-auto w-11"
              preload
            />
          </Link>
          <span className="hidden text-sm font-semibold sm:block">Administration</span>
        </div>
        <nav aria-label="Main navigation" className="flex flex-1 items-center gap-1">
          <Link
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
            className={navigationClass}
          >
            Home
          </Link>
          {signedIn ? (
            <Link
              href="/admin"
              aria-current={
                pathname === "/admin"
                  ? "page"
                  : pathname.startsWith("/admin/")
                    ? "location"
                    : undefined
              }
              className={navigationClass}
            >
              Teams
            </Link>
          ) : null}
        </nav>
        <div className="flex shrink-0 items-center">{account}</div>
      </div>
    </header>
  );
}

function AccountHeader() {
  const { isLoaded, isSignedIn } = useAuth();
  return (
    <HeaderContent
      signedIn={isSignedIn}
      account={
        isSignedIn ? (
          <UserButton
            appearance={{
              elements: {
                userButtonTrigger: "min-h-11 min-w-11 justify-center rounded-md p-1.5",
                avatarBox: "size-8",
              },
            }}
          />
        ) : isLoaded ? (
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </Link>
        ) : (
          <span role="status" className="px-3 text-sm text-muted-foreground">
            Loading account…
          </span>
        )
      }
    />
  );
}

export function SiteHeader({ authEnabled }: { authEnabled: boolean }) {
  return authEnabled ? (
    <AccountHeader />
  ) : (
    <HeaderContent
      account={
        <Link
          href="/#administrator-access"
          className="inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-medium hover:bg-accent"
        >
          Get access
        </Link>
      }
    />
  );
}
