import Image from "next/image";
import type { ReactNode } from "react";
import logo from "@/assets/apps-logo.png";
import { CircuitTraces } from "@/components/circuit-traces";
import { cn } from "@/lib/utils";

// Bumper-blue entrance band shared by the public home, sign-in and access pages.
export function PublicBand({
  children,
  className,
  badge = false,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  badge?: boolean;
}) {
  return (
    <div
      className={cn(
        "bumper-field relative isolate overflow-hidden bg-bumper text-white",
        className,
      )}
    >
      <CircuitTraces className="absolute inset-0 -z-10 size-full text-sky/40 [mask-image:linear-gradient(to_right,transparent_30%,black_75%)] md:[mask-image:none]" />
      <div className="mx-auto my-auto flex w-full max-w-6xl items-center gap-8 px-4 sm:px-6">
        <div className="min-w-0 flex-1">{children}</div>
        {badge ? (
          <Image
            src={logo}
            alt=""
            sizes="96px"
            className="hidden h-auto w-24 self-start rounded-full ring-4 ring-white/80 sm:block"
          />
        ) : null}
      </div>
      {footer ? (
        <div className="mx-auto mt-auto w-full max-w-6xl px-4 sm:px-6">{footer}</div>
      ) : null}
    </div>
  );
}

// Entrance headings in bumper numerals: heavy and wide, the second word in sky.
export const displayHeading = "font-bumper text-balance leading-[0.95]";

// A white card that overlaps the band's lower edge (request form, Clerk cards).
export const overlapCard =
  "rounded-2xl bg-surface shadow-[0_2px_6px_oklch(0.3_0.08_264/0.08),0_28px_56px_-24px_oklch(0.3_0.12_264/0.45)]";
