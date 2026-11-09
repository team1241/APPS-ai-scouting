import {
  ListSkeleton,
  LoadingPage,
  PersonLines,
  SectionSkeleton,
} from "@/components/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingPage label="Loading operators…">
      <SectionSkeleton>
        <ListSkeleton rows={2}>
          <div className="flex items-center justify-between gap-4">
            <PersonLines />
            <Skeleton className="hidden h-11 w-24 sm:block" />
          </div>
        </ListSkeleton>
      </SectionSkeleton>
      <SectionSkeleton>
        <div className="space-y-4 rounded-lg border bg-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row">
            {[0, 1].map((field) => (
              <div key={field} className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-11 w-32" />
        </div>
      </SectionSkeleton>
    </LoadingPage>
  );
}
