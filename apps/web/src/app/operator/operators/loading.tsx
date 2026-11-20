import { Bar, ListSkeleton, LoadingPage, PersonLines } from "@/components/loading-skeletons";

export default function Loading() {
  return (
    <LoadingPage label="Loading operators…">
      {/* Heading with the Add operator button, then the operator list. */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-6">
          <Bar className="h-6 w-44" />
          <Bar className="h-11 w-40 rounded-full" />
        </div>
        <ListSkeleton rows={2}>
          <div className="flex items-center justify-between gap-4">
            <PersonLines />
            <Bar className="hidden h-11 w-24 rounded-full sm:block" />
          </div>
        </ListSkeleton>
      </div>
    </LoadingPage>
  );
}
