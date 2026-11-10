"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const controlClass =
  "w-full min-w-0 rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm";

// One labelled control with its hint and its problems. Problems link to the control through
// aria-describedby, so screen readers announce them with the field.
export function Field({
  id,
  label,
  hint,
  errors = [],
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  errors?: string[];
  children: (props: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => ReactNode;
  className?: string;
}) {
  const described = [hint ? `${id}-hint` : null, errors.length ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        ...(errors.length ? { "aria-invalid": true as const } : {}),
        ...(described ? { "aria-describedby": described } : {}),
      })}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {errors.length ? (
        <div id={`${id}-error`} className="space-y-0.5 text-sm text-destructive">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProblemList({ id, errors }: { id?: string; errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div id={id} className="space-y-0.5 text-sm text-destructive">
      {errors.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}
