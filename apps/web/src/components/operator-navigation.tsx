"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/operator", label: "Applications" },
  { href: "/operator/operators", label: "Operators" },
];

// Operator-only sections. Render only after the page's operator check passes.
export function OperatorNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Operator navigation" className="border-b bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-4 py-1 sm:px-6">
        <span className="mr-3 text-sm font-semibold">Platform operator</span>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
            className="relative inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground aria-[current]:text-foreground aria-[current]:after:absolute aria-[current]:after:inset-x-3 aria-[current]:after:bottom-1.5 aria-[current]:after:h-0.5 aria-[current]:after:rounded-full aria-[current]:after:bg-primary"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
