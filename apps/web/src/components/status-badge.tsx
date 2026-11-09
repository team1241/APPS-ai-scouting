import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  success: "bg-success-soft text-success",
  waiting: "bg-accent text-primary",
  warning: "bg-warning-soft text-warning",
  danger: "bg-destructive-soft text-destructive",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type StatusTone = keyof typeof tones;

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
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
