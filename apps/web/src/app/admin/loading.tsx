import { ListSkeleton, LoadingPage } from "@/components/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingPage label="Checking your team access…">
      <ListSkeleton rows={2}>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="size-5 rounded-full" />
        </div>
      </ListSkeleton>
    </LoadingPage>
  );
}
