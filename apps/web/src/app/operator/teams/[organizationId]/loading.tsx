import { Skeleton } from "@/components/ui/skeleton";

function CardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="space-y-2.5 p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="divide-y border-t">
        {Array.from({ length: rows }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders never reorder.
          <div key={index} className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Matches the team page: back link, heading, then the two cards.
export default function Loading() {
  return (
    <main id="main" className="mx-auto max-w-3xl space-y-8 px-6 pt-6 pb-12" aria-busy="true">
      <p role="status" className="sr-only">
        Loading team…
      </p>
      <Skeleton className="h-11 w-24" />
      <div className="space-y-3">
        <Skeleton className="h-9 w-72 max-w-full sm:h-10" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <CardSkeleton rows={2} />
      <CardSkeleton rows={1} />
    </main>
  );
}
