import { Bar, ListSkeleton, LoadingPage } from "@/components/loading-skeletons";

export default function Loading() {
  return (
    <LoadingPage label="Loading teams…">
      <div className="space-y-8">
        {/* Search field, then the team list. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Bar className="h-4 w-36" />
            <Bar className="h-11 w-full rounded-xl" />
          </div>
          <Bar className="h-11 w-full rounded-full sm:w-28" />
        </div>
        <div className="space-y-4">
          <Bar className="h-6 w-48" />
          <ListSkeleton rows={4}>
            <div className="flex gap-4 sm:gap-5">
              <Bar className="h-7 w-14 shrink-0 sm:w-24" />
              <div className="flex-1 space-y-2.5">
                <Bar className="h-5 w-56 max-w-full" />
                <Bar className="h-4 w-32" />
                <Bar className="h-4 w-64 max-w-full" />
              </div>
            </div>
          </ListSkeleton>
        </div>
      </div>
    </LoadingPage>
  );
}
