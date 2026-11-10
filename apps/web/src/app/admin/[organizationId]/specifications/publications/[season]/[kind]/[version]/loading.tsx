import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div aria-hidden="true" className="border-b bg-card">
        <div className="mx-auto flex min-h-[60px] max-w-5xl items-center px-4 sm:px-6">
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <main
        id="main"
        aria-busy="true"
        className="mx-auto max-w-[60rem] space-y-6 px-4 pt-10 sm:px-6"
      >
        <p role="status" className="sr-only">
          Loading the published version…
        </p>
        <Skeleton className="h-4 w-56" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-80 max-w-full" />
          <Skeleton className="h-7 w-72 max-w-full rounded-full" />
        </div>
        <div className="rounded-xl border bg-card p-5">
          <Skeleton className="h-11 w-full" />
        </div>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex gap-4 rounded-xl border bg-card px-5 py-4">
            <Skeleton className="h-4 w-4" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-96 max-w-full" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
        ))}
      </main>
    </>
  );
}
