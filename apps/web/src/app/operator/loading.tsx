import {
  Bar,
  ListSkeleton,
  LoadingPage,
  PersonLines,
  SectionSkeleton,
} from "@/components/loading-skeletons";

export default function Loading() {
  return (
    <LoadingPage label="Loading access applications…">
      <div className="space-y-10">
        <SectionSkeleton>
          <ListSkeleton rows={2}>
            <div className="space-y-4">
              <div className="flex gap-4 sm:gap-5">
                <Bar className="h-7 w-14 sm:w-20" />
                <PersonLines wide />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:pl-29">
                <div className="flex-1 space-y-1.5">
                  <Bar className="h-4 w-20" />
                  <Bar className="h-11 w-full rounded-xl" />
                </div>
                <Bar className="h-11 w-full rounded-full sm:w-44" />
              </div>
            </div>
          </ListSkeleton>
        </SectionSkeleton>
        <SectionSkeleton>
          <ListSkeleton rows={2}>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <div className="flex gap-4 sm:gap-5">
                <Bar className="h-7 w-14 sm:w-20" />
                <PersonLines />
              </div>
              <Bar className="h-7 w-24 rounded-full" />
            </div>
          </ListSkeleton>
        </SectionSkeleton>
      </div>
    </LoadingPage>
  );
}
