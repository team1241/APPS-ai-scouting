"use client";

import Link from "next/link";
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
  useStickyHeight(nav, "--sub-header-height");
  // Sticks below the site header.
  return (
    <nav
      ref={nav}
      aria-label="Team navigation"
      className="sticky top-(--site-header-height) z-30 border-b bg-card"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <p className="min-w-0 flex-1 basis-48 text-sm [overflow-wrap:anywhere]">
          <span className="font-semibold tabular-nums">Team {organization.teamNumber}</span>
          <span aria-hidden="true" className="px-2 text-muted-foreground">
            ·
          </span>
          <span>{organization.name}</span>
        </p>
        {canChangeTeam ? (
          <Link
            href="/admin"
            className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 hover:bg-accent"
          >
            Change team
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
