"use client";

import { Skeleton } from "@heroui/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Placeholder bar in the skeleton tint.
export function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-lg", className)} />;
}

// The bumper band while a page loads: title and description bars on the field.
export function LoadingBand({
  description = true,
  number = false,
}: {
  description?: boolean;
  number?: boolean;
}) {
  return (
    <div aria-hidden="true" className="bg-bumper">
      <div className="mx-auto max-w-6xl space-y-3 px-4 pt-6 pb-8 sm:px-6 sm:pt-8 sm:pb-10">
        {number ? <div className="h-16 w-44 rounded-xl bg-white/15 sm:h-20" /> : null}
        <div className="h-9 w-72 max-w-full rounded-xl bg-white/15 sm:h-10" />
        {description ? <div className="h-5 w-full max-w-xl rounded-lg bg-white/10" /> : null}
      </div>
    </div>
  );
}

// Shared page frame for loading states: busy main, hidden status text, the
// band, and a body that matches the loaded page.
export function LoadingPage({
  label,
  description = true,
  number = false,
  children,
}: {
  label: string;
  description?: boolean;
  number?: boolean;
  children: ReactNode;
}) {
  return (
    <main id="main" aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <LoadingBand description={description} number={number} />
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </div>
    </main>
  );
}

export function SectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <Bar className="h-6 w-44" />
      {children}
    </div>
  );
}

// A surface list like the real lists, with one placeholder per row.
export function ListSkeleton({ rows, children }: { rows: number; children: ReactNode }) {
  return (
    <div className="divide-y divide-separator overflow-hidden rounded-2xl bg-surface shadow-surface">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders never reorder.
        <div key={index} className="p-5 sm:p-6">
          {children}
        </div>
      ))}
    </div>
  );
}

// A card placeholder: title and description, optional action, then body rows.
export function CardSkeleton({
  action = false,
  children,
}: {
  action?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface shadow-surface">
      <div className="flex items-start justify-between gap-6 p-5 sm:p-6">
        <div className="flex-1 space-y-3">
          <Bar className="h-5 w-32" />
          <Bar className="h-4 w-full max-w-md" />
        </div>
        {action ? <Bar className="h-11 w-36 rounded-full" /> : null}
      </div>
      {children ? <div className="border-t border-separator p-5 sm:px-6">{children}</div> : null}
    </div>
  );
}

export function PersonLines({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-2.5">
      <Bar className={wide ? "h-5 w-56 max-w-full" : "h-5 w-40"} />
      <Bar className="h-4 w-72 max-w-full" />
    </div>
  );
}
