import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The page title sits on the bumper field, continuous with the header and any
// navigation row above it. Work happens below it in PageBody.
export function PageHeading({
  children,
  number,
  description,
  actions,
  before,
  className,
}: {
  children: ReactNode;
  // A team number leads the title in bumper numerals, as on the robot.
  number?: number;
  description?: ReactNode;
  // Primary page actions, on the right on wider screens.
  actions?: ReactNode;
  // A back link or similar, above the title.
  before?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bumper-field bg-bumper text-white", className)}>
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-8 sm:px-6 sm:pt-8 sm:pb-10">
        {before ? <div className="-ml-3 mb-3">{before}</div> : null}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="text-balance [overflow-wrap:anywhere]">
              {number === undefined ? (
                <span className="font-display block text-3xl leading-[1.08] sm:text-4xl">
                  {children}
                </span>
              ) : (
                <>
                  <span className="font-bumper block text-[clamp(3.5rem,16vw,6rem)] leading-[0.88]">
                    <span className="sr-only">Team </span>
                    {number}
                  </span>
                  <span className="mt-2 block text-xl font-semibold leading-tight text-bumper-ink sm:text-2xl">
                    {children}
                  </span>
                </>
              )}
            </h1>
            {description ? (
              <p className="mt-3 max-w-prose text-pretty text-bumper-ink">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Content column below the band.
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10", className)}>
      {children}
    </div>
  );
}

// FRC teams are known by number first, so it leads lists in the bumper face.
export function TeamNumber({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("font-bumper text-accent", className)}>
      <span className="sr-only">Team </span>
      {value}
    </span>
  );
}

// A small bumper plate for a team number on the field or beside a name.
export function TeamPlate({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        "font-bumper inline-flex h-8 shrink-0 items-center rounded-lg bg-white px-2.5 text-base text-bumper",
        className,
      )}
    >
      <span className="sr-only">Team </span>
      {value}
    </span>
  );
}
