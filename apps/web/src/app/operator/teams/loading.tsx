import { ListSkeleton, LoadingPage } from "@/components/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingPage label="Loading teams…">
      {/* Search field, then the team list. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-11 w-full" />
        </div>
        <Skeleton className="h-11 w-full sm:w-28" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <ListSkeleton rows={4}>
          <div className="flex gap-5">
            <Skeleton className="h-7 w-24 shrink-0" />
            <div className="flex-1 space-y-2.5">
              <Skeleton className="h-5 w-56 max-w-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
        </ListSkeleton>
      </div>
    </LoadingPage>
  );
}
