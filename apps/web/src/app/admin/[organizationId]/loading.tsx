import { LoadingPage } from "@/components/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div aria-hidden="true" className="border-b bg-card">
        <div className="mx-auto flex min-h-[60px] max-w-5xl items-center px-4 sm:px-6">
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <LoadingPage label="Loading your team workspace…">
        <div className="rounded-xl border bg-card">
          <div className="flex items-start justify-between gap-6 p-6">
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <Skeleton className="h-7 w-28 rounded-full" />
          </div>
          <div className="border-t px-6 py-4">
            <Skeleton className="h-11 w-36" />
          </div>
        </div>
      </LoadingPage>
    </>
  );
}
