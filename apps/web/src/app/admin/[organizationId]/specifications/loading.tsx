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
      <LoadingPage label="Loading scouting specifications…">
        <div className="space-y-4">
          <Skeleton className="h-7 w-36" />
          {[3, 2].map((rows) => (
            <div key={rows} className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b px-5 py-3">
                <Skeleton className="h-4 w-28" />
              </div>
              {Array.from({ length: rows }, (_, index) => `row-${index}`).map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-4 border-b px-5 py-4 last:border-b-0"
                >
                  <Skeleton className="h-6 w-12" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-64 max-w-full" />
                  </div>
                  <Skeleton className="h-7 w-28 rounded-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </LoadingPage>
    </>
  );
}
