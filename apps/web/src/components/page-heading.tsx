import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Admin page titles share the entrance's wide display face, in navy on the light page.
export const adminHeading =
  "text-balance font-extrabold font-stretch-125% text-3xl leading-[1.05] tracking-[-0.02em] text-navy sm:text-4xl";

export function PageHeading({
  children,
  description,
  className,
}: {
  children: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <h1 className={cn(adminHeading, "[overflow-wrap:anywhere]")}>{children}</h1>
      {description ? <p className="mt-3 max-w-prose text-muted-foreground">{description}</p> : null}
    </div>
  );
}

// FRC teams are known by number first, so it leads in the display face.
export function TeamNumber({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("font-extrabold font-stretch-125% tabular-nums text-primary", className)}>
      <span className="sr-only">Team </span>
      {value}
    </span>
  );
}
