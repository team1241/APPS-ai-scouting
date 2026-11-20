import { buttonVariants } from "@heroui/styles";
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = NonNullable<Parameters<typeof buttonVariants>[0]>["variant"];

// Next.js navigation styled as a HeroUI button. Use for links that look like actions.
export function LinkButton({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}) {
  return (
    <Link className={cn(buttonVariants({ variant, size, fullWidth }), className)} {...props} />
  );
}
