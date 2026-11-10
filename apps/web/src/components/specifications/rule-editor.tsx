"use client";

import type { ComparisonOperator, ObservationKind, RuleEffect } from "@ai-scouting/scouting";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  allowedEffects,
  changeOperator,
  conditionSources,
  type EditorComparison,
  type EditorQuestion,
  type EditorRule,
  effectLabels,
  newId,
  operatorLabels,
  operatorsFor,
  ruleSentence,
  startComparison,
} from "@/lib/specification-model";
import { controlClass, ProblemList } from "./fields";

const select = `${controlClass} h-11 pr-8`;

function ValueControl({
  comparison,
  upstream,
  onChange,
  label,
}: {
  comparison: EditorComparison;
  upstream: EditorQuestion | undefined;
  onChange: (value: EditorComparison["value"]) => void;
  label: string;
}) {
  if (!upstream) return null;
  const type = upstream.answer.type;
  if (type === "boolean")
    return (
      <select
        aria-label={label}
        className={select}
        value={comparison.value === false ? "false" : "true"}
        onChange={(e) => onChange(e.target.value === "true")}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (type === "number")
    return (
      <input
        aria-label={label}
        inputMode="decimal"
        className={`${controlClass} h-11`}
        value={typeof comparison.value === "string" ? comparison.value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Number"
      />
    );
  const options = upstream.answer.options.filter((o) => o.code);
  if (Array.isArray(comparison.value)) {
    const chosen = new Set(comparison.value);
    const missing = comparison.value.filter((code) => !options.some((o) => o.code === code));
    return (
      <fieldset className="rounded-md border border-input bg-card px-3 py-2">
        <legend className="sr-only">{label}</legend>
        <div className="flex flex-wrap gap-x-4">
          {options.map((option) => (
            <label key={option.id} className="inline-flex min-h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={chosen.has(option.code)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...(comparison.value as string[]), option.code]
                      : (comparison.value as string[]).filter((c) => c !== option.code),
                  )
                }
              />
              {option.label || option.code}
            </label>
          ))}
          {missing.map((code) => (
            <label
              key={code}
              className="inline-flex min-h-9 items-center gap-2 text-sm text-destructive"
            >
              <input
                type="checkbox"
                className="size-4 accent-destructive"
                checked
                onChange={() => onChange((comparison.value as string[]).filter((c) => c !== code))}
              />
              Deleted option “{code}”
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  const value = typeof comparison.value === "string" ? comparison.value : "";
  const known = options.some((o) => o.code === value);
  return (
    <select
      aria-label={label}
      className={select}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {!known ? (
        <option value={value}>{value ? `Deleted option “${value}”` : "Choose an option"}</option>
      ) : null}
      {options.map((option) => (
        <option key={option.id} value={option.code}>
          {option.label || option.code}
        </option>
      ))}
    </select>
  );
}

function ComparisonRow({
  comparison,
  sources,
  questions,
  onChange,
  onRemove,
  position,
}: {
  comparison: EditorComparison;
  sources: EditorQuestion[];
  questions: EditorQuestion[];
  onChange: (comparison: EditorComparison) => void;
  onRemove?: () => void;
  position: number;
}) {
  const upstream = questions.find((q) => q.key === comparison.question);
  const listed = sources.some((q) => q.key === comparison.question);
  const operators = upstream ? operatorsFor(upstream.answer.type) : [];
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
      <select
        aria-label={`Condition ${position}: question`}
        className={select}
        value={comparison.question}
        onChange={(e) => {
          const next = questions.find((q) => q.key === e.target.value);
          if (next) onChange({ ...comparison, ...startComparison(next) });
        }}
      >
        {!listed ? (
          <option value={comparison.question}>
            {comparison.question
              ? upstream
                ? `${upstream.label || upstream.key} (cannot be used)`
                : `Deleted question “${comparison.question}”`
              : "Choose a question"}
          </option>
        ) : null}
        {sources.map((q) => (
          <option key={q.id} value={q.key}>
            {q.label || q.key}
          </option>
        ))}
      </select>
      <select
        aria-label={`Condition ${position}: comparison`}
        className={select}
        value={comparison.operator}
        disabled={!operators.length}
        onChange={(e) => onChange(changeOperator(comparison, e.target.value as ComparisonOperator))}
      >
        {!operators.includes(comparison.operator as ComparisonOperator) ? (
          <option value={comparison.operator}>Choose</option>
        ) : null}
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {operatorLabels[operator]}
          </option>
        ))}
      </select>
      <ValueControl
        comparison={comparison}
        upstream={upstream}
        label={`Condition ${position}: value`}
        onChange={(value) => onChange({ ...comparison, value })}
      />
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          className="h-11 justify-self-start text-muted-foreground"
          onClick={onRemove}
          aria-label={`Remove condition ${position}`}
        >
          <X aria-hidden="true" />
          <span className="sm:sr-only">Remove condition</span>
        </Button>
      ) : (
        <span className="max-sm:hidden" />
      )}
    </div>
  );
}

// Conditions are behaviour attached to the question: when to ask it and when it is required.
export function RuleEditor({
  question,
  questions,
  kind,
  problems,
  onChange,
}: {
  question: EditorQuestion;
  questions: EditorQuestion[];
  kind: ObservationKind;
  problems: Map<string, string[]>;
  onChange: (rules: EditorRule[]) => void;
}) {
  const sources = conditionSources(question, questions);
  const effects = allowedEffects(question, kind);
  const update = (id: string, rule: EditorRule) =>
    onChange(question.rules.map((r) => (r.id === id ? rule : r)));
  const addRule = () => {
    const first = sources[0];
    if (!first || !effects[0]) return;
    onChange([
      ...question.rules,
      {
        id: newId("r"),
        effect: effects[0],
        match: "all",
        comparisons: [{ id: newId("c"), ...startComparison(first) }],
      },
    ]);
  };
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Conditions</h4>
        <p className="text-sm text-muted-foreground">
          {question.rules.length
            ? "Rules read other answers in the same observation."
            : effects.length
              ? "Always asked, and always " +
                (question.required ? "required" : "optional") +
                ". Add a rule to change that based on another answer."
              : "This identity question is always asked and always required."}
        </p>
      </div>
      {question.rules.map((rule, index) => {
        const ruleEffects = effects.includes(rule.effect) ? effects : [rule.effect, ...effects];
        return (
          <div key={rule.id} className="space-y-3 rounded-lg bg-accent/70 p-3 sm:p-4">
            <p className="font-medium text-primary">{ruleSentence(rule, questions)}</p>
            {rule.nested !== undefined ? (
              <p className="text-sm">
                This rule uses nested groups, which this editor cannot show. It is kept as it is;
                remove it to write a new one.
              </p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    aria-label={`Rule ${index + 1}: effect`}
                    className={select}
                    value={rule.effect}
                    onChange={(e) =>
                      update(rule.id, { ...rule, effect: e.target.value as RuleEffect })
                    }
                  >
                    {ruleEffects.map((effect) => (
                      <option key={effect} value={effect}>
                        {effectLabels[effect]}
                      </option>
                    ))}
                  </select>
                  {rule.comparisons.length > 1 ? (
                    <select
                      aria-label={`Rule ${index + 1}: how conditions combine`}
                      className={select}
                      value={rule.match}
                      onChange={(e) =>
                        update(rule.id, { ...rule, match: e.target.value as "all" | "any" })
                      }
                    >
                      <option value="all">all of these are true</option>
                      <option value="any">any of these is true</option>
                    </select>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {rule.comparisons.map((comparison, position) => (
                    <ComparisonRow
                      key={comparison.id}
                      position={position + 1}
                      comparison={comparison}
                      sources={sources}
                      questions={questions}
                      onChange={(next) =>
                        update(rule.id, {
                          ...rule,
                          comparisons: rule.comparisons.map((c) =>
                            c.id === comparison.id ? next : c,
                          ),
                        })
                      }
                      onRemove={
                        rule.comparisons.length > 1
                          ? () =>
                              update(rule.id, {
                                ...rule,
                                comparisons: rule.comparisons.filter((c) => c.id !== comparison.id),
                              })
                          : undefined
                      }
                    />
                  ))}
                </div>
              </>
            )}
            <ProblemList errors={problems.get(`rule:${rule.id}`) ?? []} />
            <div className="flex flex-wrap gap-2">
              {rule.nested === undefined && sources[0] ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() =>
                    update(rule.id, {
                      ...rule,
                      comparisons: [
                        ...rule.comparisons,
                        { id: newId("c"), ...startComparison(sources[0] as EditorQuestion) },
                      ],
                    })
                  }
                >
                  <Plus aria-hidden="true" />
                  Add condition
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-destructive hover:text-destructive"
                onClick={() => onChange(question.rules.filter((r) => r.id !== rule.id))}
              >
                Remove rule
              </Button>
            </div>
          </div>
        );
      })}
      <ProblemList errors={problems.get("rules") ?? []} />
      {effects.length ? (
        sources.length ? (
          <Button type="button" variant="outline" className="h-11" onClick={addRule}>
            <Plus aria-hidden="true" />
            Add rule
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Add a yes-or-no, number or choice question to use it in a rule.
          </p>
        )
      ) : null}
    </div>
  );
}
