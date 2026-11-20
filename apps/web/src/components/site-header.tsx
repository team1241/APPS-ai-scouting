"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useRef } from "react";
import logo from "@/assets/apps-logo.png";
import { useStickyHeight } from "@/lib/use-sticky-height";
import { cn } from "@/lib/utils";

const quietAction =
  "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold text-bumper-ink hover:bg-white/10 hover:text-white";

// Pills on the bumper field; the current section is a lighter pill.
const navigationClass =
  "inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm sm:px-4 font-semibold text-bumper-ink transition-colors hover:bg-white/10 hover:text-white aria-[current]:bg-white/15 aria-[current]:text-white motion-reduce:transition-none";

// Rendered only after the server confirms platform-operator access.
export function OperatorNavLink({ waiting }: { waiting: number | null }) {
  const pathname = usePathname();
  return (
    <Link
      href="/operator"
      aria-current={
        pathname === "/operator"
          ? "page"
          : pathname.startsWith("/operator/")
            ? "location"
            : undefined
      }
      className={navigationClass}
    >
      Operator
      {waiting ? (
        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky px-1.5 text-xs font-bold text-bumper-deep tabular-nums">
          {waiting}
          <span className="sr-only"> {waiting === 1 ? "application" : "applications"} waiting</span>
        </span>
      ) : null}
    </Link>
  );
}

function HeaderContent({
  signedIn = false,
  account,
  operatorEntry,
}: {
  signedIn?: boolean;
  account: ReactNode;
  operatorEntry?: ReactNode;
}) {
  const pathname = usePathname();
  const header = useRef<HTMLElement>(null);
  useStickyHeight(header, "--site-header-height");
  return (
    <header ref={header} className="bumper-field sticky top-0 z-40 bg-bumper text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-x-2 px-4 py-2 sm:gap-x-5 sm:px-6 sm:py-2.5">
        <Link
          href={signedIn ? "/admin" : "/"}
          aria-label="Theory6 Apps home"
          className="group inline-flex min-h-11 shrink-0 items-center gap-3 rounded-full pr-1"
        >
          <Image
            src={logo}
            alt=""
            width={40}
            height={40}
            sizes="40px"
            className="size-10 rounded-full ring-2 ring-white/80 transition-shadow group-hover:ring-white"
            preload
          />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="font-display text-base">Theory6</span>
            <span className="mt-1 text-xs font-semibold text-sky">Administration</span>
          </span>
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1"
        >
          <Link
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
            // Signed in, the logo already leads to Teams; drop Home on phones to keep one row.
            className={cn(navigationClass, signedIn && "max-sm:hidden")}
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
          {signedIn ? operatorEntry : null}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">{account}</div>
      </div>
    </header>
  );
}

function AccountHeader({ operatorEntry }: { operatorEntry?: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  return (
    <HeaderContent
      signedIn={isSignedIn}
      operatorEntry={operatorEntry}
      account={
        isSignedIn ? (
          <UserButton
            appearance={{
              elements: {
                userButtonTrigger:
                  "min-h-11 min-w-11 justify-center rounded-full p-1.5 focus-visible:outline-2 focus-visible:outline-sky",
                avatarBox: "size-8 ring-2 ring-white/70",
              },
            }}
          />
        ) : isLoaded ? (
          <>
            {pathname === "/request-access" ? null : (
              <Link href="/request-access" className={`${quietAction} max-sm:hidden`}>
                Request access
              </Link>
            )}
            {pathname.startsWith("/sign-in") ? null : (
              <Link
                href="/sign-in"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-bumper-deep shadow-sm transition-colors hover:bg-bumper-ink motion-reduce:transition-none"
              >
                Sign in
              </Link>
            )}
          </>
        ) : (
          <span role="status" className="px-3 text-sm text-bumper-ink">
            Loading account…
          </span>
        )
      }
    />
  );
}

export function SiteHeader({
  authEnabled,
  operatorEntry,
}: {
  authEnabled: boolean;
  operatorEntry?: ReactNode;
}) {
  return authEnabled ? (
    <AccountHeader operatorEntry={operatorEntry} />
  ) : (
    <HeaderContent
      account={
        <Link href="/request-access" className={quietAction}>
          Request access
        </Link>
      }
    />
  );
}
