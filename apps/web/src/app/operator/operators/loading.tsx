import { ListSkeleton, LoadingPage, PersonLines } from "@/components/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingPage label="Loading operators…">
      {/* Heading with the Add operator button, then the operator list. */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-6">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-11 w-36" />
        </div>
        <ListSkeleton rows={2}>
          <div className="flex items-center justify-between gap-4">
            <PersonLines />
            <Skeleton className="hidden h-11 w-24 sm:block" />
          </div>
        </ListSkeleton>
      </div>
    </LoadingPage>
  );
}
