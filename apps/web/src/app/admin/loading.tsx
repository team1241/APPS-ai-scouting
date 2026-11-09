import { ListSkeleton, LoadingPage } from "@/components/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingPage label="Checking your team access…">
      <ListSkeleton rows={2}>
        <div className="flex items-center gap-5">
          <Skeleton className="h-7 w-16" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="size-5 rounded-full" />
        </div>
      </ListSkeleton>
    </LoadingPage>
  );
}
