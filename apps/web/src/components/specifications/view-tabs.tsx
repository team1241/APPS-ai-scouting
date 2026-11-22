"use client";

import { cn } from "@/lib/utils";

export interface ViewTab<V extends string> {
  id: V;
  name: string;
  count?: number;
}

// The underline tab row over a specification: arrow keys move between tabs. Each panel is
// `panel-<id>`, labelled by `tab-<id>`.
export function ViewTabs<V extends string>({
  label,
  tabs,
  view,
  onChange,
}: {
  label: string;
  tabs: ViewTab<V>[];
  view: V;
  onChange: (view: V) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-separator px-4 sm:mx-0 sm:px-0"
    >
      {tabs.map(({ id, name, count }, index) => (
        <button
          key={id}
          id={`tab-${id}`}
          type="button"
          role="tab"
          aria-selected={view === id}
          aria-controls={`panel-${id}`}
          tabIndex={view === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            const next = tabs[(index + step + tabs.length) % tabs.length]?.id;
            if (!next) return;
            onChange(next);
            document.getElementById(`tab-${next}`)?.focus();
          }}
          className={cn(
            "relative inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-t-xl px-3 text-sm font-semibold whitespace-nowrap outline-none transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/40 motion-reduce:transition-none",
            view === id
              ? "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full after:bg-accent"
              : "text-muted hover:text-foreground",
          )}
        >
          {name}
          {count !== undefined ? (
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums",
                view === id ? "bg-accent text-accent-foreground" : "bg-default text-muted",
              )}
            >
              {count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
