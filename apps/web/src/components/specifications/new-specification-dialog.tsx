"use client";

import type { ObservationKind } from "@ai-scouting/scouting";
import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Radio,
  RadioGroup,
  TextField,
} from "@heroui/react";
import { FilePlus2 } from "lucide-react";
import { type ReactNode, useActionState, useEffect, useId, useRef, useState } from "react";
import {
  type CreateSpecificationState,
  createSpecification,
} from "@/app/admin/specification-actions";
import { DialogActions, FormDialog } from "@/components/form-dialog";
import { kindLabels } from "@/lib/specification-model";
import type { PublicationSummary } from "@/lib/specifications";
import { useEditedErrors } from "@/lib/use-edited-errors";
import { cn } from "@/lib/utils";
import { ChoiceSelect } from "./choice-select";

const copyKey = (p: PublicationSummary) => `publication:${p.season}:${p.version}`;

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

// A selectable card: the whole card is the radio's label.
const radioCard = cn(
  "flex min-h-11 w-full cursor-(--cursor-interactive) items-start gap-3 rounded-xl border border-border bg-surface p-3 text-sm transition-colors motion-reduce:transition-none",
  "data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft",
  "data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-2 data-[focus-visible=true]:outline-focus",
  "data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60",
);

function RadioCard({
  value,
  title,
  hint,
  isDisabled,
}: {
  value: string;
  title: string;
  hint: ReactNode;
  isDisabled?: boolean;
}) {
  return (
    <Radio value={value} isDisabled={isDisabled} className="mt-0! w-full">
      <Radio.Content className={radioCard}>
        <Radio.Control className="mt-0.5 shrink-0">
          <Radio.Indicator />
        </Radio.Control>
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{title}</span>
          <span className="block text-muted">{hint}</span>
        </span>
      </Radio.Content>
    </Radio>
  );
}

function NewSpecificationForm({
  organizationId,
  defaults,
  publications,
  onPendingChange,
  onCancel,
}: {
  organizationId: string;
  defaults: NewSpecificationDefaults;
  publications: PublicationSummary[];
  onPendingChange: (pending: boolean) => void;
  onCancel: () => void;
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
  const { edit, shown } = useEditedErrors<keyof CreateSpecificationState["errors"]>(state);
  const error = (field: keyof CreateSpecificationState["errors"]) =>
    shown(field, state.errors[field]);
  const copies = publications.filter((p) => p.kind === kind);
  const [copy, setCopy] = useState(state.values.source);
  // The chosen version when it fits the kind, otherwise the first one, as a native select did.
  const copyValue = copies.some((p) => copyKey(p) === copy)
    ? copy
    : copies[0]
      ? copyKey(copies[0])
      : "";
  return (
    <form ref={form} action={submit} className="grid gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      {state.message ? (
        <p
          role="alert"
          className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-foreground"
        >
          {state.message}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <TextField
          name="season"
          defaultValue={state.values.season}
          isDisabled={pending}
          isInvalid={Boolean(error("season"))}
          onChange={() => edit("season")}
        >
          <Label>Season</Label>
          <Input inputMode="numeric" autoComplete="off" className="tabular-nums" />
          <FieldError>{error("season")}</FieldError>
        </TextField>
        <TextField
          name="name"
          maxLength={80}
          defaultValue={state.values.name}
          isDisabled={pending}
          isInvalid={Boolean(error("name"))}
          onChange={() => edit("name")}
        >
          <Label>Name</Label>
          <Input autoComplete="off" placeholder="For example, Pit scouting 2027" />
          <FieldError>{error("name")}</FieldError>
        </TextField>
      </div>
      {defaults.fixedSource ? (
        <>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="source" value={state.values.source} />
        </>
      ) : (
        <>
          <RadioGroup
            name="kind"
            value={kind || null}
            onChange={(value) => {
              setKind(value);
              edit("kind");
              edit("source");
              if (!publications.some((p) => p.kind === value) && source === "publication")
                setSource("template");
            }}
            isDisabled={pending}
            isInvalid={Boolean(error("kind"))}
            className="gap-2"
          >
            <Label>Kind</Label>
            {(["match", "pit", "general"] as const).map((value) => (
              <RadioCard
                key={value}
                value={value}
                title={kindLabels[value]}
                hint={kindHints[value]}
              />
            ))}
            <FieldError>{error("kind")}</FieldError>
          </RadioGroup>
          <div className="space-y-3">
            <RadioGroup
              value={source}
              onChange={(value) => {
                setSource(value);
                edit("source");
              }}
              isDisabled={pending}
              className="gap-2"
            >
              <Label>Start from</Label>
              <RadioCard
                value="template"
                title="Example questions"
                hint="A worked example for the kind, with conditions. Edit or remove anything."
              />
              <RadioCard
                value="blank"
                title="Identity questions only"
                hint="Start from scratch with the match and team questions the kind needs."
              />
              <RadioCard
                value="publication"
                isDisabled={!copies.length}
                title="A published version"
                hint={
                  kind
                    ? copies.length
                      ? "Copy its questions into a new draft."
                      : `No ${kindLabels[kind as ObservationKind].toLowerCase()} versions are published yet.`
                    : "Choose a kind first."
                }
              />
            </RadioGroup>
            {source === "publication" && copies.length ? (
              <div className="space-y-1.5">
                <label htmlFor={`${id}-copy`} className="text-sm font-medium">
                  Version to copy
                </label>
                <ChoiceSelect
                  id={`${id}-copy`}
                  name="source"
                  value={copyValue}
                  onChange={(value) => {
                    setCopy(value);
                    edit("source");
                  }}
                  choices={copies.map((p) => ({
                    value: copyKey(p),
                    label: `${p.season} · ${p.version}${p.name ? ` · ${p.name}` : ""}`,
                  }))}
                />
              </div>
            ) : (
              <input
                type="hidden"
                name="source"
                value={source === "publication" ? "blank" : source}
              />
            )}
            {error("source") ? (
              <Description className="text-danger">{error("source")}</Description>
            ) : null}
          </div>
        </>
      )}
      <DialogActions>
        <Button variant="tertiary" isDisabled={pending} onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isPending={pending}>
          {pending ? "Creating draft…" : "Create draft"}
        </Button>
      </DialogActions>
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
  // "field" is the white action on the blue page band.
  variant?: "default" | "outline" | "ghost" | "field";
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // A new form each time the dialog opens, so earlier values and errors do not carry over.
  const [opened, setOpened] = useState(0);
  return (
    <>
      <Button
        variant={variant === "default" || variant === "field" ? "primary" : variant}
        className={
          variant === "field"
            ? "bg-white text-bumper-deep shadow-sm hover:bg-bumper-ink max-sm:w-full"
            : undefined
        }
        onPress={() => {
          setOpened((count) => count + 1);
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <FormDialog
        isOpen={open}
        onOpenChange={setOpen}
        isPending={pending}
        size="lg"
        icon={<FilePlus2 className="size-5" />}
        title={title}
        description={
          defaults.fixedSource
            ? `Copies ${defaults.fixedSource.label} into a draft you can edit. The original does not change.`
            : "Creates a draft. Nothing changes for scouts until you publish a version and choose it for an event."
        }
      >
        <NewSpecificationForm
          key={opened}
          organizationId={organizationId}
          defaults={defaults}
          publications={publications}
          onPendingChange={setPending}
          onCancel={() => setOpen(false)}
        />
      </FormDialog>
    </>
  );
}
