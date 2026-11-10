"use client";

import type { ObservationKind } from "@ai-scouting/scouting";
import { useActionState, useEffect, useRef, useState } from "react";
import { type AssignState, assignSpecification } from "@/app/admin/specification-actions";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { kindLabels } from "@/lib/specification-model";
import { dateFormat, type EventAssignments } from "@/lib/specifications";

function AssignDialog({
  organizationId,
  event,
  kind,
  season,
  version,
  current,
  clear = false,
}: {
  organizationId: string;
  event: EventAssignments["event"];
  kind: ObservationKind;
  season: number;
  version: string;
  current: string | null;
  clear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState<AssignState, FormData>(assignSpecification, {});
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) setOpen(false);
    wasPending.current = pending;
  }, [pending, state]);
  const lower = kindLabels[kind].toLowerCase();
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? null : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant={clear ? "ghost" : "outline"} className="h-11">
          {clear ? "Stop using" : "Use for new sessions"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={submit} className="grid gap-5">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="season" value={season} />
          <input type="hidden" name="version" value={clear ? "" : version} />
          <DialogHeader>
            <DialogTitle>
              {clear
                ? `Stop ${lower} scouting with ${version} at ${event.name}?`
                : `Use ${version} for ${lower} scouting at ${event.name}?`}
            </DialogTitle>
            <DialogDescription>
              {clear
                ? `New ${lower} sessions at this event will not have a specification.`
                : `New ${lower} sessions at this event use ${version}${current ? ` instead of ${current}` : ""}.`}{" "}
              Sessions already open keep the version they started with, and recorded observations do
              not change.
            </DialogDescription>
          </DialogHeader>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending} className="h-11">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} className="h-11 px-5">
              {pending ? "Saving…" : clear ? "Stop using" : `Use ${version}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Which events start new sessions with this publication. Publishing alone changes no event.
export function EventAssignmentList({
  organizationId,
  kind,
  season,
  version,
  formatVersion,
  events,
}: {
  organizationId: string;
  kind: ObservationKind;
  season: number;
  version: string;
  formatVersion: number | null;
  events: EventAssignments[] | null;
}) {
  const lower = kindLabels[kind].toLowerCase();
  // Match intake runs the starter format until custom extraction is connected (#48).
  const matchBlocked = kind === "match" && formatVersion !== 1;
  return (
    <section aria-labelledby="events-title" className="rounded-xl border bg-card">
      <div className="p-5 sm:p-6">
        <h2 id="events-title" className="text-lg font-semibold">
          Events
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the {season} events whose new {lower} sessions use {version}. Open sessions keep
          their version.
        </p>
        {matchBlocked ? (
          <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
            Match scouting cannot use custom questions yet. Keep the current match specification at
            events until custom extraction is available.
          </p>
        ) : null}
      </div>
      {events === null ? (
        <p className="border-t px-6 py-4 text-sm">
          Events are unavailable right now. Reload the page to try again.
        </p>
      ) : !events.length ? (
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          This team has no current {season} events.
        </p>
      ) : (
        <ul className="divide-y border-t">
          {events.map(({ event, ...assignments }) => {
            const current = assignments[kind]?.version ?? null;
            const inUse = current === version;
            return (
              <li
                key={event.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-medium [overflow-wrap:anywhere]">{event.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {event.startDate
                      ? dateFormat.format(new Date(`${event.startDate}T12:00:00`))
                      : null}
                    {event.startDate ? " · " : null}
                    {current ? `New sessions use ${current}` : `No ${lower} specification`}
                  </p>
                </div>
                {inUse ? (
                  <>
                    <StatusBadge tone="success">In use for new sessions</StatusBadge>
                    {kind !== "match" ? (
                      <AssignDialog
                        organizationId={organizationId}
                        event={event}
                        kind={kind}
                        season={season}
                        version={version}
                        current={current}
                        clear
                      />
                    ) : null}
                  </>
                ) : matchBlocked ? null : (
                  <AssignDialog
                    organizationId={organizationId}
                    event={event}
                    kind={kind}
                    season={season}
                    version={version}
                    current={current}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
