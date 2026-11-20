import { Bar, LoadingPage } from "@/components/loading-skeletons";

export default function Loading() {
  return (
    <>
      <div aria-hidden="true" className="border-t border-white/10 bg-bumper">
        <div className="mx-auto flex min-h-[56px] max-w-6xl items-center gap-3 px-4 sm:px-6">
          <div className="h-7 w-14 rounded-lg bg-white/20" />
          <div className="h-4 w-40 rounded-lg bg-white/15" />
        </div>
      </div>
      <LoadingPage label="Loading scouting specifications…">
        <div className="space-y-4">
          <Bar className="h-7 w-36" />
          {[3, 2].map((rows) => (
            <div key={rows} className="overflow-hidden rounded-2xl bg-surface shadow-surface">
              <div className="border-b border-separator bg-surface-secondary px-5 py-3 sm:px-6">
                <Bar className="h-4 w-28" />
              </div>
              {Array.from({ length: rows }, (_, index) => `row-${index}`).map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-4 border-b border-separator px-5 py-4 last:border-b-0 sm:px-6"
                >
                  <Bar className="h-6 w-12" />
                  <div className="flex-1 space-y-2">
                    <Bar className="h-5 w-48" />
                    <Bar className="h-4 w-64 max-w-full" />
                  </div>
                  <Bar className="h-7 w-28 rounded-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </LoadingPage>
    </>
  );
}
