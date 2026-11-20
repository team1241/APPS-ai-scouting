"use client";

import { ListBox, Select } from "@heroui/react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface Choice {
  value: string;
  label: ReactNode;
  // Shown for a stored value the admin can no longer choose, such as a deleted option.
  tone?: "danger";
}

// Collection keys avoid the empty string, so "nothing chosen" travels as this value internally.
const EMPTY = "__empty__";

// The builder's dropdown: the HeroUI Select with the 44px admin control size. Values are
// plain strings; an empty string is a real choice ("Not stated") when listed in `choices`.
// A visible <label for={id}> names it, as for a native control.
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
  const selected = unique.find((c) => c.value === value);
  const listed = selected !== undefined;
  // The trigger is a button, so an outside label names it through aria-labelledby.
  const [labelledBy, setLabelledBy] = useState<string>();
  useEffect(() => {
    if (ariaLabel || !id) return;
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
    if (!label) return;
    if (!label.id) label.id = `${id}-label`;
    setLabelledBy(label.id);
  }, [ariaLabel, id]);
  return (
    <Select
      id={id}
      name={name}
      fullWidth
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : labelledBy}
      aria-describedby={ariaDescribedBy}
      isInvalid={ariaInvalid || undefined}
      isDisabled={disabled}
      placeholder={placeholder ?? "Choose"}
      value={listed ? encode(value) : null}
      onChange={(next) => {
        if (next === null) return;
        const key = String(next);
        onChange(key === EMPTY ? "" : key);
      }}
      className={cn("min-w-0", className)}
    >
      <Select.Trigger className="min-h-11 w-full">
        <Select.Value
          className={cn("min-w-0 truncate", selected?.tone === "danger" && "text-danger")}
        />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="max-h-80">
        <ListBox>
          {unique.map((choice) => (
            <ListBox.Item
              key={choice.value}
              id={encode(choice.value)}
              textValue={typeof choice.label === "string" ? choice.label : choice.value}
              className={cn(
                "min-h-11 md:min-h-9",
                choice.tone === "danger" && "text-danger-soft-foreground",
              )}
            >
              {choice.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
