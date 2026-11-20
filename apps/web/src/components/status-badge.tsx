"use client";

import { Chip } from "@heroui/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const colors = {
  success: "success",
  waiting: "accent",
  warning: "warning",
  danger: "danger",
  neutral: "default",
} as const;

export type StatusTone = keyof typeof colors;

// One status vocabulary for every admin list and card. The text carries the
// state; the colour and dot only reinforce it.
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Chip
      color={colors[tone]}
      variant="soft"
      size="lg"
      className={cn(
        "h-7 gap-2 rounded-full px-3 text-[0.8125rem] font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-default text-muted",
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      <Chip.Label className="inline-flex items-center gap-1.5">{children}</Chip.Label>
    </Chip>
  );
}
