import {
  ListSkeleton,
  LoadingPage,
  PersonLines,
  SectionSkeleton,
} from "@/components/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingPage label="Loading access applications…">
      <SectionSkeleton>
        <ListSkeleton rows={2}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex gap-5">
                <Skeleton className="h-7 w-16" />
                <PersonLines wide />
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:pl-29">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-11 w-full" />
              </div>
              <Skeleton className="h-11 w-full sm:w-40" />
            </div>
          </div>
        </ListSkeleton>
      </SectionSkeleton>
      <SectionSkeleton>
        <ListSkeleton rows={2}>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <div className="flex gap-5">
              <Skeleton className="h-7 w-16" />
              <PersonLines />
            </div>
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        </ListSkeleton>
      </SectionSkeleton>
    </LoadingPage>
  );
}
