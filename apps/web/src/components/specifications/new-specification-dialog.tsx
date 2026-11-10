"use client";

import type { ObservationKind } from "@ai-scouting/scouting";
import { type ReactNode, useActionState, useEffect, useId, useRef, useState } from "react";
import {
  type CreateSpecificationState,
  createSpecification,
} from "@/app/admin/specification-actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { kindLabels } from "@/lib/specification-model";
import type { PublicationSummary } from "@/lib/specifications";
import { cn } from "@/lib/utils";

const kindHints: Record<ObservationKind, string> = {
  match: "One robot in one match. Always names the match and team.",
  pit: "One team's robot, from a pit visit. Always names the team.",
  general: "Anything else at an event. Match and team are optional.",
};

export interface NewSpecificationDefaults {
  season: number;
  kind?: ObservationKind;
  name?: string;
  // blank, template, publication:<season>:<version> or draft:<id>
  source?: string;
  // Fixed sources (copying a draft or a publication) hide the kind and source choices.
  fixedSource?: { label: string };
}

const radioCard =
  "flex min-h-11 cursor-pointer gap-3 rounded-lg border bg-card p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50";

function NewSpecificationForm({
  organizationId,
  defaults,
  publications,
  onPendingChange,
  title,
}: {
  organizationId: string;
  defaults: NewSpecificationDefaults;
  publications: PublicationSummary[];
  onPendingChange: (pending: boolean) => void;
  title: string;
}) {
  const [state, submit, pending] = useActionState<CreateSpecificationState, FormData>(
    createSpecification,
    {
      status: "idle",
      errors: {},
      values: {
        season: String(defaults.season),
        kind: defaults.kind ?? "",
        name: defaults.name ?? "",
        source: defaults.source ?? "template",
      },
    },
  );
  const [kind, setKind] = useState(state.values.kind);
  const [source, setSource] = useState(
    state.values.source.startsWith("publication:") ? "publication" : state.values.source,
  );
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  useEffect(() => {
    if (state.status !== "error") return;
    const invalid = form.current?.querySelector<HTMLElement>("[aria-invalid=true]");
    invalid?.focus();
  }, [state]);
  const copies = publications.filter((p) => p.kind === kind);
  const error = (field: keyof CreateSpecificationState["errors"]) =>
    state.errors[field] ? (
      <p id={`${id}-${field}-error`} className="text-sm text-destructive">
        {state.errors[field]}
      </p>
    ) : null;
  const described = (field: keyof CreateSpecificationState["errors"]) =>
    state.errors[field] ? { "aria-invalid": true, "aria-describedby": `${id}-${field}-error` } : {};
  return (
    <form ref={form} action={submit} className="grid gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {defaults.fixedSource
            ? `Copies ${defaults.fixedSource.label} into a draft you can edit. The original does not change.`
            : "Creates a draft. Nothing changes for scouts until you publish a version and choose it for an event."}
        </DialogDescription>
      </DialogHeader>
      {state.message ? (
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-season`}>Season</Label>
          <Input
            id={`${id}-season`}
            name="season"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={state.values.season}
            disabled={pending}
            className="h-11 tabular-nums"
            {...described("season")}
          />
          {error("season")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            name="name"
            maxLength={80}
            autoComplete="off"
            placeholder="For example, Pit scouting 2027"
            defaultValue={state.values.name}
            disabled={pending}
            className="h-11"
            {...described("name")}
          />
          {error("name")}
        </div>
      </div>
      {defaults.fixedSource ? (
        <>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="source" value={state.values.source} />
        </>
      ) : (
        <>
          <fieldset className="space-y-2" disabled={pending}>
            <legend className="mb-2 text-sm font-medium">Kind</legend>
            <div className="grid gap-2">
              {(["match", "pit", "general"] as const).map((value) => (
                <label key={value} className={radioCard}>
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => {
                      setKind(value);
                      if (!publications.some((p) => p.kind === value) && source === "publication")
                        setSource("template");
                    }}
                    className="mt-0.5 size-4 accent-primary"
                    {...(state.errors.kind ? { "aria-invalid": true } : {})}
                  />
                  <span>
                    <span className="font-medium">{kindLabels[value]}</span>
                    <span className="block text-muted-foreground">{kindHints[value]}</span>
                  </span>
                </label>
              ))}
            </div>
            {error("kind")}
          </fieldset>
          <fieldset className="space-y-2" disabled={pending}>
            <legend className="mb-2 text-sm font-medium">Start from</legend>
            <div className="grid gap-2">
              <label className={radioCard}>
                <input
                  type="radio"
                  name="sourceType"
                  checked={source === "template"}
                  onChange={() => setSource("template")}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="font-medium">Example questions</span>
                  <span className="block text-muted-foreground">
                    A worked example for the kind, with conditions. Edit or remove anything.
                  </span>
                </span>
              </label>
              <label className={radioCard}>
                <input
                  type="radio"
                  name="sourceType"
                  checked={source === "blank"}
                  onChange={() => setSource("blank")}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="font-medium">Identity questions only</span>
                  <span className="block text-muted-foreground">
                    Start from scratch with the match and team questions the kind needs.
                  </span>
                </span>
              </label>
              <label className={cn(radioCard, !copies.length && "cursor-not-allowed opacity-60")}>
                <input
                  type="radio"
                  name="sourceType"
                  checked={source === "publication"}
                  disabled={!copies.length}
                  onChange={() => setSource("publication")}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">A published version</span>
                  <span className="block text-muted-foreground">
                    {kind
                      ? copies.length
                        ? "Copy its questions into a new draft."
                        : `No ${kindLabels[kind as ObservationKind].toLowerCase()} versions are published yet.`
                      : "Choose a kind first."}
                  </span>
                </span>
              </label>
            </div>
            {source === "publication" && copies.length ? (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor={`${id}-copy`}>Version to copy</Label>
                <select
                  id={`${id}-copy`}
                  name="source"
                  defaultValue={
                    copies.some(
                      (p) => `publication:${p.season}:${p.version}` === state.values.source,
                    )
                      ? state.values.source
                      : undefined
                  }
                  className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {copies.map((p) => (
                    <option
                      key={`${p.season}:${p.version}`}
                      value={`publication:${p.season}:${p.version}`}
                    >
                      {p.season} · {p.version}
                      {p.name ? ` · ${p.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input
                type="hidden"
                name="source"
                value={source === "publication" ? "blank" : source}
              />
            )}
            {error("source")}
          </fieldset>
        </>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending} className="h-11">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {pending ? "Creating draft…" : "Create draft"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewSpecificationDialog({
  organizationId,
  defaults,
  publications,
  trigger,
  title = "New specification",
  variant = "default",
}: {
  organizationId: string;
  defaults: NewSpecificationDefaults;
  publications: PublicationSummary[];
  trigger: ReactNode;
  title?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? null : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} className="h-11 px-4">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <NewSpecificationForm
          organizationId={organizationId}
          defaults={defaults}
          publications={publications}
          onPendingChange={setPending}
          title={title}
        />
      </DialogContent>
    </Dialog>
  );
}
