import type * as React from "react";
import { cn } from "@/lib/utils";

// Decorative placeholder. Pair it with a screen-reader status message.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-md bg-skeleton motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
