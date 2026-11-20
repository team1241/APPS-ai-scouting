import { Bar, LoadingPage } from "@/components/loading-skeletons";

export default function Loading() {
  return (
    <LoadingPage label="Checking your team access…">
      <div className="grid gap-3">
        {[0, 1].map((row) => (
          <div
            key={row}
            className="flex items-center gap-4 rounded-2xl bg-surface p-3 pr-5 shadow-surface sm:gap-5"
          >
            <Bar className="h-16 w-24 rounded-xl sm:w-28" />
            <div className="flex-1 space-y-2.5">
              <Bar className="h-5 w-44" />
              <Bar className="h-4 w-28" />
            </div>
            <Bar className="size-5 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingPage>
  );
}
