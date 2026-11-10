import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { specificationsPath } from "@/lib/specifications";

// Workspace summary that leads to the builder.
export function SpecificationsCard({
  organizationId,
  counts,
}: {
  organizationId: string;
  counts: { drafts: number; publications: number } | null;
}) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <section className="rounded-xl border bg-card" aria-labelledby="specifications-title">
      <Link
        href={specificationsPath(organizationId)}
        className="flex items-center gap-4 rounded-xl p-6 outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="min-w-0 flex-1">
          <h2 id="specifications-title" className="text-lg font-semibold">
            Scouting specifications
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The questions scouts are asked for match, pit and general observations.
          </p>
          <p className="mt-3 text-sm">
            {counts
              ? counts.drafts + counts.publications
                ? `${plural(counts.drafts, "draft", "drafts")} · ${plural(counts.publications, "published version", "published versions")}`
                : "None yet. Start from example questions."
              : "Status unavailable"}
          </p>
        </div>
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </section>
  );
}
