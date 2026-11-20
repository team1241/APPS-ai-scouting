"use client";

import { Label } from "@heroui/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Native controls styled as HeroUI fields, for places that need a plain <input> or <textarea>.
export const controlClass =
  "w-full min-w-0 rounded-field border border-(--field-border) bg-field px-3 text-base text-field-foreground shadow-field outline-none transition-[border-color,box-shadow] placeholder:text-field-placeholder hover:border-(--field-border-hover) focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:bg-default disabled:text-muted read-only:bg-surface-secondary aria-invalid:border-danger aria-invalid:ring-danger/20 motion-reduce:transition-none sm:text-sm";

// HeroUI Input and TextArea take this for the invalid outline, since they sit outside a
// TextField and read invalid state from aria-invalid.
export const invalidClass =
  "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/20";

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
      <Label htmlFor={id} id={`${id}-label`} className="block text-sm font-semibold">
        {label}
      </Label>
      {children({
        id,
        ...(errors.length ? { "aria-invalid": true as const } : {}),
        ...(described ? { "aria-describedby": described } : {}),
      })}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {errors.length ? (
        <div id={`${id}-error`} className="space-y-0.5 text-sm font-medium text-danger">
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
    <div id={id} className="space-y-0.5 text-sm font-medium text-danger">
      {errors.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}
