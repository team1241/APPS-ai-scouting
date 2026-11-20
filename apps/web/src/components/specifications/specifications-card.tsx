import { ChevronRight, ClipboardList } from "lucide-react";
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
    <section
      className="rounded-2xl bg-surface shadow-surface"
      aria-labelledby="specifications-title"
    >
      <Link
        href={specificationsPath(organizationId)}
        className="group flex items-center gap-4 rounded-2xl p-5 transition-colors hover:bg-surface-secondary focus-visible:outline-offset-[-3px] motion-reduce:transition-none sm:p-6"
      >
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-foreground"
        >
          <ClipboardList className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="specifications-title" className="text-[1.0625rem] font-semibold">
            Scouting specifications
          </h2>
          <p className="mt-1 text-sm text-muted">
            The questions scouts are asked for match, pit and general observations.
          </p>
          <p className="mt-2 text-sm font-medium">
            {counts
              ? counts.drafts + counts.publications
                ? `${plural(counts.drafts, "draft", "drafts")} · ${plural(counts.publications, "published version", "published versions")}`
                : "None yet. Start from example questions."
              : "Status unavailable"}
          </p>
        </div>
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
        />
      </Link>
    </section>
  );
}
