"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { fieldTabClass } from "@/components/nav-styles";
import { TeamPlate } from "@/components/page-heading";
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
  // Sticks below the site header from tablet width up; on phones it scrolls away to save height.
  return (
    <nav
      ref={nav}
      aria-label="Team navigation"
      className="bumper-field z-30 border-t sm:sticky sm:top-(--site-header-height) border-white/10 bg-bumper text-white"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-1.5 sm:px-6">
        <p className="flex min-w-0 basis-48 items-center gap-2.5 py-1.5 text-sm font-semibold [overflow-wrap:anywhere] sm:flex-1">
          <TeamPlate value={organization.teamNumber} className="h-7 text-sm" />
          <span className="min-w-0">{organization.name}</span>
        </p>
        <div className="-mx-3 flex flex-wrap items-center gap-x-1 pb-1 sm:mx-0">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current(link.href)}
              className={fieldTabClass}
            >
              {link.label}
            </Link>
          ))}
          {canChangeTeam ? (
            <Link
              href="/admin"
              className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-sky underline decoration-sky/50 underline-offset-4 hover:bg-white/10"
            >
              Change team
            </Link>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
