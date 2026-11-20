import { Bar, CardSkeleton, LoadingPage } from "@/components/loading-skeletons";

export default function Loading() {
  return (
    <>
      <div aria-hidden="true" className="border-t border-white/10 bg-bumper">
        <div className="mx-auto flex min-h-[56px] max-w-6xl items-center gap-3 px-4 sm:px-6">
          <div className="h-7 w-14 rounded-lg bg-white/20" />
          <div className="h-4 w-40 rounded-md bg-white/15" />
        </div>
      </div>
      <LoadingPage label="Loading your team workspace…" number>
        {/* Telegram, specifications, administrators, then API keys. */}
        <CardSkeleton>
          <Bar className="h-11 w-36 rounded-full" />
        </CardSkeleton>
        <CardSkeleton />
        <CardSkeleton action>
          <Bar className="h-10 w-full max-w-xs" />
        </CardSkeleton>
        <CardSkeleton action>
          <Bar className="h-11 w-full" />
        </CardSkeleton>
      </LoadingPage>
    </>
  );
}
