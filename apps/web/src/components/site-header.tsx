"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import logo from "@/assets/apps-logo.png";

const quietAction =
  "inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium text-sky-soft hover:bg-white/10 hover:text-white";

const navigationClass =
  "relative inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-sky-soft hover:text-white aria-[current]:text-white aria-[current]:after:absolute aria-[current]:after:inset-x-3 aria-[current]:after:bottom-1.5 aria-[current]:after:h-0.5 aria-[current]:after:rounded-full aria-[current]:after:bg-sky";

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
        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky px-1.5 text-xs font-semibold text-navy tabular-nums">
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
  return (
    <header className="public-band border-b border-sky/15 bg-navy text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:gap-x-6 sm:px-6">
        <Link
          href={signedIn ? "/admin" : "/"}
          aria-label="Theory6 Apps home"
          className="group inline-flex min-h-11 shrink-0 items-center gap-3 rounded-full pr-1"
        >
          <Image
            src={logo}
            alt=""
            width={44}
            height={44}
            sizes="44px"
            className="size-11 rounded-full ring-1 ring-sky/40 transition-shadow group-hover:ring-2 group-hover:ring-sky"
            preload
          />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="font-extrabold text-base font-stretch-125% tracking-[-0.01em]">
              Theory6
            </span>
            <span className="mt-1 text-xs font-medium text-sky">Administration</span>
          </span>
        </Link>
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
          {signedIn ? operatorEntry : null}
        </nav>
        <div className="flex shrink-0 items-center gap-1">{account}</div>
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
                avatarBox: "size-8 ring-1 ring-sky/50",
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
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-sky px-4 text-sm font-semibold text-navy hover:bg-sky-soft"
              >
                Sign in
              </Link>
            )}
          </>
        ) : (
          <span role="status" className="px-3 text-sm text-sky-soft">
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
