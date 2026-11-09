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
        <div className="space-y-3 rounded-xl border bg-card p-6">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </LoadingPage>
    </>
  );
}
