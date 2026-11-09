import Image from "next/image";
import type { ReactNode } from "react";
import logo from "@/assets/apps-logo.png";
import { CircuitTraces } from "@/components/circuit-traces";
import { cn } from "@/lib/utils";

// Navy entrance band shared by the public home and access application pages.
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
      className={cn("public-band relative isolate overflow-hidden bg-navy text-white", className)}
    >
      <CircuitTraces className="absolute inset-0 -z-10 size-full text-sky/35 [mask-image:linear-gradient(to_right,transparent_30%,black_75%)] md:[mask-image:none]" />
      <div className="mx-auto my-auto flex w-full max-w-5xl items-center gap-8 px-6">
        <div className="min-w-0 flex-1">{children}</div>
        {badge ? (
          <Image
            src={logo}
            alt=""
            sizes="96px"
            className="hidden h-auto w-24 self-start rounded-full ring-1 ring-sky/40 sm:block"
          />
        ) : null}
      </div>
      {footer ? <div className="mx-auto mt-auto w-full max-w-5xl px-6">{footer}</div> : null}
    </div>
  );
}

export const displayHeading =
  "text-balance font-extrabold font-stretch-125% leading-[0.98] tracking-[-0.02em]";
