"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Choice {
  value: string;
  label: ReactNode;
  // Shown for a stored value the admin can no longer choose, such as a deleted option.
  tone?: "danger";
}

// Radix reserves the empty string, so "nothing chosen" travels as this value internally.
const EMPTY = "__empty__";

// The builder's dropdown: the shadcn Select with the 44px admin control size. Values are
// plain strings; an empty string is a real choice ("Not stated") when listed in `choices`.
export function ChoiceSelect({
  value,
  onChange,
  choices,
  placeholder,
  className,
  disabled,
  name,
  id,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  choices: Choice[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const encode = (v: string) => (v === "" ? EMPTY : v);
  // A draft can hold duplicate codes while it is being fixed; list each value once.
  const unique = choices.filter((c, i) => choices.findIndex((o) => o.value === c.value) === i);
  const listed = unique.some((c) => c.value === value);
  return (
    <Select
      name={name}
      value={listed ? encode(value) : ""}
      onValueChange={(next) => onChange(next === EMPTY ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        className={cn(
          "min-h-11 w-full bg-card text-base shadow-xs disabled:bg-muted disabled:opacity-100 md:text-sm [&>span]:min-w-0 [&>span]:truncate",
          className,
        )}
      >
        <SelectValue placeholder={placeholder ?? "Choose"} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {unique.map((choice) => (
          <SelectItem
            key={choice.value}
            value={encode(choice.value)}
            className={cn(
              "min-h-11 text-base md:min-h-9 md:text-sm",
              choice.tone === "danger" && "text-destructive",
            )}
          >
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
