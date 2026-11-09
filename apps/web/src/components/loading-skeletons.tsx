import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// Shared page frame for loading states: busy main, hidden status text, and a
// heading and description placeholder that match the loaded page.
export function LoadingPage({
  label,
  description = true,
  children,
}: {
  label: string;
  description?: boolean;
  children: ReactNode;
}) {
  return (
    <main id="main" className="mx-auto max-w-3xl space-y-10 px-6 py-12" aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className="space-y-3">
        <Skeleton className="h-8 w-64 max-w-full" />
        {description ? <Skeleton className="h-5 w-full max-w-xl" /> : null}
      </div>
      {children}
    </main>
  );
}

export function SectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-44" />
      {children}
    </div>
  );
}

// A bordered list like the real lists, with one placeholder per row.
export function ListSkeleton({ rows, children }: { rows: number; children: ReactNode }) {
  return (
    <div className="divide-y overflow-hidden rounded-lg border bg-card">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders never reorder.
        <div key={index} className="p-6">
          {children}
        </div>
      ))}
    </div>
  );
}

export function PersonLines({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-2.5">
      <Skeleton className={wide ? "h-5 w-56 max-w-full" : "h-5 w-40"} />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}
