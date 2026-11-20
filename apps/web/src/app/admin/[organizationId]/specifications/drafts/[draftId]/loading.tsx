import { Bar, LoadingBand } from "@/components/loading-skeletons";

export default function Loading() {
  return (
    <>
      <div aria-hidden="true" className="border-t border-white/10 bg-bumper">
        <div className="mx-auto flex min-h-[56px] max-w-6xl items-center gap-3 px-4 sm:px-6">
          <div className="h-7 w-14 rounded-lg bg-white/20" />
          <div className="h-4 w-40 rounded-lg bg-white/15" />
        </div>
      </div>
      <main id="main" aria-busy="true">
        <p role="status" className="sr-only">
          Loading the draft…
        </p>
        <LoadingBand />
        <div className="mx-auto max-w-[60rem] space-y-4 px-4 py-8 sm:px-6">
          <div className="flex gap-2">
            <Bar className="h-11 w-24 rounded-full" />
            <Bar className="h-11 w-36 rounded-full" />
            <Bar className="h-11 w-36 rounded-full" />
          </div>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex gap-4 rounded-2xl bg-surface px-5 py-4 shadow-surface">
              <Bar className="h-4 w-4" />
              <div className="flex-1 space-y-2">
                <Bar className="h-6 w-96 max-w-full" />
                <Bar className="h-4 w-64 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
