"use client";

import {
  type Contract,
  finalizeWithEvaluation,
  type ObservationKind,
  type Question,
  sampleCasesFor,
} from "@ai-scouting/scouting";
import { Button, Checkbox, Input } from "@heroui/react";
import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import {
  answerSummary,
  defaultSummary,
  type EditorQuestion,
  ruleSentence,
} from "@/lib/specification-model";
import {
  answerFromInput,
  explain,
  requirementLabel,
  type SampleAnswers,
  stateView,
  tallyFromInput,
} from "@/lib/specification-preview";
import { cn } from "@/lib/utils";
import { ChoiceSelect } from "./choice-select";
import { FollowUpMessage, RuleLine } from "./preview-parts";

const textAction = "min-h-9 px-2 text-accent-soft-foreground";

function AnswerInput({
  question,
  value,
  onChange,
  id,
  describedBy,
}: {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
  describedBy: string;
}) {
  const { answer } = question;
  const common = { id, "aria-describedby": describedBy };
  if (answer.type === "text" || answer.type === "number")
    return (
      <Input
        {...common}
        fullWidth
        className={cn(answer.type === "number" && "max-w-48 tabular-nums")}
        inputMode={answer.type === "number" ? "decimal" : undefined}
        placeholder="Not stated"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  if (answer.type === "boolean")
    return (
      <ChoiceSelect
        {...common}
        className="max-w-48"
        value={value === true ? "true" : value === false ? "false" : ""}
        onChange={(next) => onChange(next === "" ? undefined : next === "true")}
        choices={[
          { value: "", label: "Not stated" },
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]}
      />
    );
  if (answer.type === "single_choice")
    return (
      <ChoiceSelect
        {...common}
        className="max-w-sm"
        value={typeof value === "string" ? value : ""}
        onChange={(next) => onChange(next || undefined)}
        choices={[
          { value: "", label: "Not stated" },
          ...answer.options.map((option) => ({ value: option.code, label: option.label })),
        ]}
      />
    );
  if (answer.type === "tally") {
    const counts =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, string>)
        : {};
    return (
      <fieldset {...common} className="space-y-2">
        <legend className="sr-only">{question.label}</legend>
        <div className="grid max-w-xl gap-x-8 gap-y-2 sm:grid-cols-2">
          {answer.options.map((option) => (
            <div key={option.code} className="flex min-w-0 items-center gap-3 text-sm">
              <label
                htmlFor={`${id}-${option.code}`}
                className="min-w-0 flex-1 [overflow-wrap:anywhere]"
              >
                {option.label}
              </label>
              <Input
                id={`${id}-${option.code}`}
                className="w-24 tabular-nums"
                inputMode="numeric"
                placeholder="Not stated"
                value={counts[option.code] ?? ""}
                onChange={(e) => onChange({ ...counts, [option.code]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </fieldset>
    );
  }
  const chosen = Array.isArray(value) ? (value as string[]) : null;
  return (
    <fieldset {...common} className="space-y-2">
      <legend className="sr-only">{question.label}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {answer.options.map((option) => (
          <Checkbox
            key={option.code}
            className="min-h-9"
            isSelected={chosen?.includes(option.code) ?? false}
            onChange={(checked) =>
              onChange(
                checked
                  ? [...(chosen ?? []), option.code]
                  : (chosen ?? []).filter((c) => c !== option.code),
              )
            }
          >
            <Checkbox.Content className="text-sm">
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {option.label}
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted">
        {chosen === null
          ? "Not stated."
          : chosen.length
            ? `${chosen.length} selected.`
            : "None of these. This counts as an answer."}
        {chosen?.length !== 0 ? (
          <Button size="sm" variant="ghost" className={textAction} onPress={() => onChange([])}>
            Set to none of these
          </Button>
        ) : null}
        {chosen !== null ? (
          <Button
            size="sm"
            variant="ghost"
            className={textAction}
            onPress={() => onChange(undefined)}
          >
            Clear
          </Button>
        ) : null}
      </p>
    </fieldset>
  );
}

// Deterministic preview (#49): the admin enters answers, and the shared evaluator decides what
// is asked, what is required and what the scout is asked next. No model is involved.
export function AnswerPreview({
  kind,
  contract,
  questions,
}: {
  kind: ObservationKind;
  contract: Contract;
  questions: EditorQuestion[];
}) {
  const [inputs, setInputs] = useState<SampleAnswers>({});
  const [sample, setSample] = useState("");
  const samples = sampleCasesFor(kind);
  const { result, evaluation } = useMemo(() => {
    const values: SampleAnswers = {};
    for (const question of contract.questions) {
      const raw = inputs[question.key];
      if (raw === undefined) continue;
      const value =
        typeof raw === "string"
          ? answerFromInput(question, raw)
          : question.answer.type === "tally" && raw && typeof raw === "object"
            ? tallyFromInput(raw as Record<string, string>)
            : raw;
      if (value !== null) values[question.key] = value;
    }
    return finalizeWithEvaluation(contract, [values]);
  }, [contract, inputs]);

  const loadSample = (id: string) => {
    setSample(id);
    const chosen = samples.find((s) => s.id === id);
    if (!chosen) return;
    const merged: SampleAnswers = Object.assign({}, ...chosen.turns);
    const next: SampleAnswers = {};
    for (const question of contract.questions) {
      const value = merged[question.key];
      if (value === undefined || value === null) continue;
      next[question.key] =
        question.answer.type === "number" || question.answer.type === "text"
          ? String(value)
          : question.answer.type === "tally" && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([code, count]) => [code, String(count)]),
              )
            : value;
    }
    setInputs(next);
  };
  const answered = Object.keys(result.values).length;
  const complete = result.status === "complete";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-xl">Preview answers</h2>
          <p className="max-w-[65ch] text-sm text-muted">
            Enter answers a scout might give. The same rules as live scouting decide what is asked,
            what is required and what the scout is asked next. No AI is used, and nothing is saved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceSelect
            id="preview-sample"
            aria-label="Load a sample"
            className="w-56"
            placeholder="Load a sample…"
            value={sample}
            onChange={loadSample}
            choices={samples.map((s) => ({ value: s.id, label: s.title }))}
          />
          <Button
            variant="outline"
            isDisabled={!Object.keys(inputs).length}
            onPress={() => {
              setInputs({});
              setSample("");
            }}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            Clear answers
          </Button>
        </div>
      </div>
      {sample ? (
        <p className="text-sm text-muted">
          {samples.find((s) => s.id === sample)?.shows} Sample answers fill only questions with the
          same code as the worked example.
        </p>
      ) : null}

      <section
        aria-labelledby="preview-outcome"
        aria-live="polite"
        className="space-y-4 rounded-2xl bg-surface p-5 shadow-surface sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 id="preview-outcome" className="font-semibold">
            Outcome
          </h3>
          <StatusBadge tone={complete ? "success" : "warning"}>
            {complete ? "Complete" : "Needs follow-up"}
          </StatusBadge>
          <span className="text-sm text-muted tabular-nums">
            {answered} of {contract.questions.length} answered
            {result.missing.length ? ` · ${result.missing.length} missing or unusable` : ""}
          </span>
        </div>
        <FollowUpMessage question={result.question} />
      </section>

      <ol className="divide-y divide-separator rounded-2xl bg-surface shadow-surface">
        {evaluation.questions.map((outcome, index) => {
          const question = contract.questions[index] as Question;
          const editor = questions.find((q) => q.key === question.key);
          const state = stateView(outcome);
          const id = `preview-${question.key}`;
          const hidden = outcome.visibility === "hidden";
          const reasons = explain(question, outcome);
          const kept = Object.hasOwn(result.inactive, question.key);
          return (
            <li
              key={question.key}
              className="grid gap-x-4 gap-y-3 px-4 py-5 sm:grid-cols-[2rem_1fr] sm:px-6"
            >
              <span className="font-bumper pt-0.5 text-sm text-muted max-sm:hidden">
                {index + 1}
              </span>
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <label
                      htmlFor={id}
                      className={cn(
                        "block text-[1.0625rem] leading-snug font-semibold text-foreground [overflow-wrap:anywhere]",
                        hidden && "text-muted",
                      )}
                    >
                      {question.prompt}
                    </label>
                    <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">
                      <span className="font-medium text-foreground">{question.label}</span>
                      {" · "}
                      {editor ? answerSummary(editor) : question.answer.type}
                      {" · "}
                      {requirementLabel(outcome)}
                      {editor && defaultSummary(editor)
                        ? ` · Default: ${defaultSummary(editor)}`
                        : null}
                    </p>
                  </div>
                  <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                </div>
                <AnswerInput
                  id={id}
                  describedBy={`${id}-why`}
                  question={question}
                  value={inputs[question.key]}
                  onChange={(value) =>
                    setInputs((current) => {
                      const next = { ...current };
                      if (value === undefined || value === "") delete next[question.key];
                      else next[question.key] = value;
                      return next;
                    })
                  }
                />
                <div id={`${id}-why`} className="space-y-1.5 text-sm">
                  {outcome.problem ? (
                    <p className="font-medium text-danger">
                      This answer cannot be used: {outcome.problem}.
                    </p>
                  ) : null}
                  {reasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                  {kept ? (
                    <p className="text-muted">
                      The answer is kept as history only. It is not used while the question is not
                      asked.
                    </p>
                  ) : null}
                  {editor && outcome.rules.length ? (
                    <ul className="space-y-1">
                      {outcome.rules.map((rule) => {
                        const editorRule = editor.rules[rule.index];
                        return editorRule ? (
                          <RuleLine
                            key={editorRule.id}
                            outcome={rule}
                            sentence={ruleSentence(editorRule, questions)}
                          />
                        ) : null;
                      })}
                    </ul>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
