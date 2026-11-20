"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fieldTabClass } from "@/components/nav-styles";

// Operator-only sections. Render only after the layout's operator check passes.
export function OperatorNavigation({ waiting }: { waiting: number | null }) {
  const pathname = usePathname();
  const links = [
    { href: "/operator", label: "Applications", count: waiting },
    { href: "/operator/teams", label: "All teams", count: null },
    { href: "/operator/operators", label: "Operators", count: null },
  ];
  // A team's detail page sits under All teams.
  const current = (href: string) =>
    pathname === href || (href === "/operator/teams" && pathname.startsWith(`${href}/`));
  const ariaCurrent = (href: string) =>
    pathname === href ? "page" : current(href) ? "location" : undefined;
  const count = (value: number | null, className: string) =>
    value ? (
      <span
        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky px-1.5 text-xs font-bold text-bumper-deep tabular-nums ${className}`}
      >
        {value}
        <span className="sr-only"> waiting</span>
      </span>
    ) : null;
  return (
    <nav
      aria-label="Operator navigation"
      className="bumper-field border-t border-white/10 bg-bumper text-white"
    >
      {/* Phones: one segmented control, three equal tabs that always fit on one line.
          The header's Operator pill and the page description carry the scope. */}
      <div className="px-4 py-2 sm:hidden">
        <p className="sr-only">Platform operator</p>
        <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-1 rounded-full bg-bumper-deep/60 p-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={ariaCurrent(link.href)}
              className="relative flex min-h-11 items-center justify-center rounded-full px-1 text-[0.8125rem] font-semibold whitespace-nowrap text-bumper-ink transition-colors hover:text-white aria-[current]:bg-white aria-[current]:text-bumper-deep aria-[current]:shadow-sm motion-reduce:transition-none"
            >
              {link.label}
              {count(link.count, "absolute -top-1 right-0 h-4 min-w-4 px-1 text-[0.6875rem]")}
            </Link>
          ))}
        </div>
      </div>
      {/* Tablet and up: the scope chip, then underlined tabs. */}
      <div className="mx-auto hidden max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-6 py-1.5 sm:flex">
        <span className="mr-3 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-bumper-deep px-3 text-xs font-bold text-white">
          <ShieldCheck aria-hidden="true" className="size-4 text-sky" />
          Platform operator
        </span>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={ariaCurrent(link.href)}
            className={fieldTabClass}
          >
            {link.label}
            {count(link.count, "ml-2")}
          </Link>
        ))}
      </div>
    </nav>
  );
}
