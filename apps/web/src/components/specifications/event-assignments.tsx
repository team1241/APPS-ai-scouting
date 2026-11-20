"use client";

import type { ObservationKind } from "@ai-scouting/scouting";
import { Button } from "@heroui/react";
import { CalendarCheck } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { type AssignState, assignSpecification } from "@/app/admin/specification-actions";
import { DialogActions, FormDialog } from "@/components/form-dialog";
import { StatusBadge } from "@/components/status-badge";
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
    <>
      <Button
        variant={clear ? "ghost" : "outline"}
        className={clear ? "text-danger hover:bg-danger-soft" : undefined}
        onPress={() => setOpen(true)}
      >
        {clear ? "Stop using" : "Use for new sessions"}
      </Button>
      <FormDialog
        isOpen={open}
        onOpenChange={setOpen}
        isPending={pending}
        icon={<CalendarCheck className="size-5" />}
        title={
          clear
            ? `Stop ${lower} scouting with ${version} at ${event.name}?`
            : `Use ${version} for ${lower} scouting at ${event.name}?`
        }
        description={
          <>
            {clear
              ? `New ${lower} sessions at this event will not have a specification.`
              : `New ${lower} sessions at this event use ${version}${current ? ` instead of ${current}` : ""}.`}{" "}
            Sessions already open keep the version they started with, and recorded observations do
            not change.
          </>
        }
      >
        <form action={submit} className="grid gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="season" value={season} />
          <input type="hidden" name="version" value={clear ? "" : version} />
          {state.error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {state.error}
            </p>
          ) : null}
          <DialogActions>
            <Button variant="tertiary" isDisabled={pending} onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={clear ? "danger" : "primary"} isPending={pending}>
              {pending ? "Saving…" : clear ? "Stop using" : `Use ${version}`}
            </Button>
          </DialogActions>
        </form>
      </FormDialog>
    </>
  );
}

// Which events start new sessions with this publication. Publishing alone changes no event.
export function EventAssignmentList({
  organizationId,
  kind,
  season,
  version,
  events,
}: {
  organizationId: string;
  kind: ObservationKind;
  season: number;
  version: string;
  events: EventAssignments[] | null;
}) {
  const lower = kindLabels[kind].toLowerCase();
  return (
    <section aria-labelledby="events-title" className="rounded-2xl bg-surface shadow-surface">
      <div className="p-5 sm:p-6">
        <h2 id="events-title" className="text-[1.0625rem] font-semibold">
          Events
        </h2>
        <p className="mt-1 text-sm text-muted">
          Choose the {season} events whose new {lower} sessions use {version}. Open sessions keep
          their version.
        </p>
      </div>
      {events === null ? (
        <p className="border-t border-separator px-5 py-4 text-sm sm:px-6">
          Events are unavailable right now. Reload the page to try again.
        </p>
      ) : !events.length ? (
        <p className="border-t border-separator px-5 py-4 text-sm text-muted sm:px-6">
          This team has no current {season} events.
        </p>
      ) : (
        <ul className="divide-y divide-separator border-t border-separator">
          {events.map(({ event, ...assignments }) => {
            const current = assignments[kind]?.version ?? null;
            const inUse = current === version;
            return (
              <li
                key={event.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-semibold [overflow-wrap:anywhere]">{event.name}</p>
                  <p className="text-sm text-muted">
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
                ) : (
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
