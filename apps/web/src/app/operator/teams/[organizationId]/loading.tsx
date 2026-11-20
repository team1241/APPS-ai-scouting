import { Bar, LoadingBand } from "@/components/loading-skeletons";

function CardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-2xl bg-surface shadow-surface">
      <div className="space-y-2.5 p-5 sm:p-6">
        <Bar className="h-6 w-40" />
        <Bar className="h-4 w-full max-w-lg" />
      </div>
      <div className="divide-y divide-separator border-t border-separator">
        {Array.from({ length: rows }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders never reorder.
          <div key={index} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
            <div className="space-y-2">
              <Bar className="h-5 w-40" />
              <Bar className="h-4 w-56 max-w-full" />
            </div>
            <Bar className="h-7 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Matches the team page: band with the number, name and description, then the two cards.
export default function Loading() {
  return (
    <main id="main" aria-busy="true">
      <p role="status" className="sr-only">
        Loading team…
      </p>
      <LoadingBand number />
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <CardSkeleton rows={2} />
        <CardSkeleton rows={1} />
      </div>
    </main>
  );
}
