"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Operator-only sections. Render only after the layout's operator check passes.
export function OperatorNavigation({ waiting }: { waiting: number | null }) {
  const pathname = usePathname();
  const links = [
    { href: "/operator", label: "Applications", count: waiting },
    { href: "/operator/operators", label: "Operators", count: null },
  ];
  return (
    <nav aria-label="Operator navigation" className="border-b bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-2 sm:px-6">
        <span className="mr-2 inline-flex h-7 items-center gap-1.5 rounded-full bg-navy px-2 text-xs font-semibold text-white sm:mr-3 sm:px-3">
          <ShieldCheck aria-hidden="true" className="size-3.5 text-sky" />
          <span className="max-sm:sr-only">Platform operator</span>
        </span>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
            className="relative inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground aria-[current]:text-foreground aria-[current]:after:absolute aria-[current]:after:inset-x-3 aria-[current]:after:bottom-1.5 aria-[current]:after:h-0.5 aria-[current]:after:rounded-full aria-[current]:after:bg-primary"
          >
            {link.label}
            {link.count ? (
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
                {link.count}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
