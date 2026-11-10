"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import type { Organization } from "@/lib/backend";
import { useStickyHeight } from "@/lib/use-sticky-height";

// Only render with the organization returned by the page's current access check.
export function TeamNavigation({
  organization,
  canChangeTeam,
}: {
  organization: Organization;
  canChangeTeam: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useStickyHeight(nav, "--sub-header-height");
  const base = `/admin/${organization.id}`;
  const links = [
    { href: base, label: "Workspace" },
    { href: `${base}/specifications`, label: "Scouting specifications" },
  ];
  // Drafts and publications sit under Scouting specifications.
  const current = (href: string) =>
    pathname === href
      ? "page"
      : href !== base && pathname.startsWith(`${href}/`)
        ? "location"
        : undefined;
  // Sticks below the site header.
  return (
    <nav
      ref={nav}
      aria-label="Team navigation"
      className="sticky top-(--site-header-height) z-30 border-b bg-card"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-1 sm:px-6">
        <p className="min-w-0 basis-48 py-2 text-sm [overflow-wrap:anywhere] sm:flex-1">
          <span className="font-semibold tabular-nums">Team {organization.teamNumber}</span>
          <span aria-hidden="true" className="px-2 text-muted-foreground">
            ·
          </span>
          <span>{organization.name}</span>
        </p>
        <div className="-mx-3 flex flex-wrap items-center gap-x-1 sm:mx-0">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current(link.href)}
              className="relative inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground aria-[current]:text-foreground aria-[current]:after:absolute aria-[current]:after:inset-x-3 aria-[current]:after:bottom-1.5 aria-[current]:after:h-0.5 aria-[current]:after:rounded-full aria-[current]:after:bg-primary"
            >
              {link.label}
            </Link>
          ))}
          {canChangeTeam ? (
            <Link
              href="/admin"
              className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 hover:bg-accent"
            >
              Change team
            </Link>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
