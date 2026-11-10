"use client";

import {
  type Contract,
  finalizeWithEvaluation,
  type ObservationKind,
  type Question,
  sampleCasesFor,
} from "@ai-scouting/scouting";
import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { answerSummary, type EditorQuestion, ruleSentence } from "@/lib/specification-model";
import {
  answerFromInput,
  explain,
  requirementLabel,
  type SampleAnswers,
  stateView,
} from "@/lib/specification-preview";
import { cn } from "@/lib/utils";
import { ChoiceSelect } from "./choice-select";
import { controlClass } from "./fields";
import { FollowUpMessage, RuleLine } from "./preview-parts";

const input = `${controlClass} h-11`;

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
      <input
        {...common}
        className={cn(input, answer.type === "number" && "max-w-48 tabular-nums")}
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
  const chosen = Array.isArray(value) ? (value as string[]) : null;
  return (
    <fieldset {...common} className="space-y-2">
      <legend className="sr-only">{question.label}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {answer.options.map((option) => (
          <label key={option.code} className="inline-flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={chosen?.includes(option.code) ?? false}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...(chosen ?? []), option.code]
                    : (chosen ?? []).filter((c) => c !== option.code),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
        {chosen === null
          ? "Not stated."
          : chosen.length
            ? `${chosen.length} selected.`
            : "None of these. This counts as an answer."}
        {chosen?.length !== 0 ? (
          <button
            type="button"
            className="min-h-9 text-primary underline-offset-4 hover:underline"
            onClick={() => onChange([])}
          >
            Set to none of these
          </button>
        ) : null}
        {chosen !== null ? (
          <button
            type="button"
            className="min-h-9 text-primary underline-offset-4 hover:underline"
            onClick={() => onChange(undefined)}
          >
            Clear
          </button>
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
      const value = typeof raw === "string" ? answerFromInput(question, raw) : raw;
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
          <h2 className="text-lg font-semibold">Preview answers</h2>
          <p className="max-w-[65ch] text-sm text-muted-foreground">
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
            type="button"
            variant="outline"
            className="h-11"
            disabled={!Object.keys(inputs).length}
            onClick={() => {
              setInputs({});
              setSample("");
            }}
          >
            <RotateCcw aria-hidden="true" />
            Clear answers
          </Button>
        </div>
      </div>
      {sample ? (
        <p className="text-sm text-muted-foreground">
          {samples.find((s) => s.id === sample)?.shows} Sample answers fill only questions with the
          same code as the worked example.
        </p>
      ) : null}

      <section
        aria-labelledby="preview-outcome"
        aria-live="polite"
        className="space-y-3 rounded-xl border bg-card p-5"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 id="preview-outcome" className="font-semibold">
            Outcome
          </h3>
          <StatusBadge tone={complete ? "success" : "warning"}>
            {complete ? "Complete" : "Needs follow-up"}
          </StatusBadge>
          <span className="text-sm text-muted-foreground tabular-nums">
            {answered} of {contract.questions.length} answered
            {result.missing.length ? ` · ${result.missing.length} missing or unusable` : ""}
          </span>
        </div>
        <FollowUpMessage question={result.question} />
      </section>

      <ol className="divide-y rounded-xl border bg-card">
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
              className="grid gap-x-4 gap-y-3 px-4 py-5 sm:grid-cols-[2rem_1fr] sm:px-5"
            >
              <span className="text-sm text-muted-foreground tabular-nums max-sm:hidden">
                {index + 1}
              </span>
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <label
                      htmlFor={id}
                      className={cn(
                        "block text-base leading-snug font-medium text-navy [overflow-wrap:anywhere]",
                        hidden && "text-muted-foreground",
                      )}
                    >
                      {question.prompt}
                    </label>
                    <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      <span className="font-medium text-foreground">{question.label}</span>
                      {" · "}
                      {editor ? answerSummary(editor) : question.answer.type}
                      {" · "}
                      {requirementLabel(outcome)}
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
                    <p className="text-destructive">
                      This answer cannot be used: {outcome.problem}.
                    </p>
                  ) : null}
                  {reasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                  {kept ? (
                    <p className="text-muted-foreground">
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
