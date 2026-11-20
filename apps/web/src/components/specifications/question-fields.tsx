"use client";

import type { AnswerType, ObservationKind } from "@ai-scouting/scouting";
import { Button, Checkbox, Input, TextArea } from "@heroui/react";
import { ArrowDown, ArrowUp, Lock, Plus, X } from "lucide-react";
import {
  answerTypeLabels,
  codeFromLabel,
  type EditorAnswer,
  type EditorQuestion,
  identityPolicies,
  identityPolicy,
  newId,
} from "@/lib/specification-model";
import { ChoiceSelect } from "./choice-select";
import { Field, invalidClass, ProblemList } from "./fields";
import { RuleEditor } from "./rule-editor";

const input = invalidClass;
const textarea = `min-h-20 leading-relaxed ${invalidClass}`;

function OptionsEditor({
  question,
  problems,
  onChange,
}: {
  question: EditorQuestion;
  problems: Map<string, string[]>;
  onChange: (answer: EditorAnswer) => void;
}) {
  const { answer } = question;
  const options = answer.options;
  const set = (next: typeof options) => onChange({ ...answer, options: next });
  const move = (index: number, by: number) => {
    const next = [...options];
    const [item] = next.splice(index, 1);
    if (item) next.splice(index + by, 0, item);
    set(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Options</legend>
      <p className="text-sm text-muted">
        Answers store the option code. Rename a label at any time; keep a code once a version using
        it is in use.
      </p>
      {options.length ? (
        <ol className="space-y-2">
          {options.map((option, index) => {
            const errors = problems.get(`option:${option.id}`) ?? [];
            const id = `option-${option.id}`;
            return (
              <li key={option.id} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                  <Input
                    fullWidth
                    id={`${id}-label`}
                    aria-label={`Option ${index + 1} label`}
                    className={input}
                    value={option.label}
                    placeholder="Label"
                    aria-invalid={errors.length ? true : undefined}
                    aria-describedby={errors.length ? `${id}-error` : undefined}
                    onChange={(e) => {
                      const label = e.target.value;
                      const others = options.filter((o) => o.id !== option.id).map((o) => o.code);
                      set(
                        options.map((o) =>
                          o.id === option.id
                            ? {
                                ...o,
                                label,
                                code: o.codeLocked
                                  ? o.code
                                  : codeFromLabel(label, others, "option"),
                              }
                            : o,
                        ),
                      );
                    }}
                  />
                  <Input
                    fullWidth
                    aria-label={`Option ${index + 1} code`}
                    className={`${input} col-start-1 font-mono sm:col-start-auto`}
                    value={option.code}
                    placeholder="code"
                    spellCheck={false}
                    autoCapitalize="none"
                    aria-invalid={errors.length ? true : undefined}
                    onChange={(e) =>
                      set(
                        options.map((o) =>
                          o.id === option.id ? { ...o, code: e.target.value, codeLocked: true } : o,
                        ),
                      )
                    }
                  />
                  <span className="col-start-2 row-span-2 row-start-1 flex items-start sm:col-start-auto sm:row-span-1">
                    <Button
                      variant="ghost"
                      isIconOnly
                      className="size-11"
                      isDisabled={index === 0}
                      aria-label={`Move option ${index + 1} up`}
                      onPress={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      isIconOnly
                      className="size-11"
                      isDisabled={index === options.length - 1}
                      aria-label={`Move option ${index + 1} down`}
                      onPress={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      isIconOnly
                      className="size-11 text-muted"
                      aria-label={`Remove option ${index + 1}`}
                      onPress={() => set(options.filter((o) => o.id !== option.id))}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </Button>
                  </span>
                </div>
                <ProblemList id={`${id}-error`} errors={errors} />
              </li>
            );
          })}
        </ol>
      ) : null}
      <ProblemList errors={problems.get("options") ?? []} />
      <Button
        variant="outline"
        onPress={() =>
          set([
            ...options,
            {
              id: newId("o"),
              label: "",
              code: codeFromLabel(
                "",
                options.map((o) => o.code),
                "option",
              ),
              codeLocked: false,
            },
          ])
        }
      >
        <Plus aria-hidden="true" className="size-4" />
        Add option
      </Button>
    </fieldset>
  );
}

function AnswerEditor({
  question,
  locked,
  problems,
  onChange,
}: {
  question: EditorQuestion;
  locked: boolean;
  problems: Map<string, string[]>;
  onChange: (answer: EditorAnswer) => void;
}) {
  const { answer } = question;
  const id = `q-${question.id}`;
  const set = (patch: Partial<EditorAnswer>) => onChange({ ...answer, ...patch });
  if (answer.type === "number")
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${id}-format`} label="Number format">
          {(props) => (
            <ChoiceSelect
              {...props}
              value={answer.format}
              disabled={locked}
              onChange={(format) => set({ format: format as "integer" | "decimal" })}
              choices={[
                { value: "integer", label: "Whole number" },
                { value: "decimal", label: "Decimal" },
              ]}
            />
          )}
        </Field>
        <Field id={`${id}-min`} label="Minimum" errors={problems.get("min")} hint="Optional">
          {(props) => (
            <Input
              fullWidth
              {...props}
              inputMode="decimal"
              className={`${input} tabular-nums`}
              value={answer.min}
              onChange={(e) => set({ min: e.target.value })}
            />
          )}
        </Field>
        <Field id={`${id}-max`} label="Maximum" errors={problems.get("max")} hint="Optional">
          {(props) => (
            <Input
              fullWidth
              {...props}
              inputMode="decimal"
              className={`${input} tabular-nums`}
              value={answer.max}
              onChange={(e) => set({ max: e.target.value })}
            />
          )}
        </Field>
      </div>
    );
  if (answer.type === "text")
    return (
      <Field
        id={`${id}-max-length`}
        label="Longest answer, in characters"
        hint="Optional. Leave empty for no limit (up to 20,000)."
        errors={problems.get("maxLength")}
        className="max-w-xs"
      >
        {(props) => (
          <Input
            fullWidth
            {...props}
            inputMode="numeric"
            className={`${input} tabular-nums`}
            value={answer.maxLength}
            onChange={(e) => set({ maxLength: e.target.value })}
          />
        )}
      </Field>
    );
  if (answer.type === "boolean")
    return (
      <p className="text-sm text-muted">
        Scouts answer yes or no. A clear “no” is recorded as an answer, not as missing.
      </p>
    );
  return (
    <div className="space-y-4">
      <OptionsEditor question={question} problems={problems} onChange={onChange} />
      {answer.type === "multiple_choice" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`${id}-min-selected`}
            label="Fewest selections"
            hint="Optional. 0 allows “none of these”."
            errors={problems.get("minSelected")}
          >
            {(props) => (
              <Input
                fullWidth
                {...props}
                inputMode="numeric"
                className={`${input} tabular-nums`}
                value={answer.minSelected}
                onChange={(e) => set({ minSelected: e.target.value })}
              />
            )}
          </Field>
          <Field
            id={`${id}-max-selected`}
            label="Most selections"
            hint="Optional."
            errors={problems.get("maxSelected")}
          >
            {(props) => (
              <Input
                fullWidth
                {...props}
                inputMode="numeric"
                className={`${input} tabular-nums`}
                value={answer.maxSelected}
                onChange={(e) => set({ maxSelected: e.target.value })}
              />
            )}
          </Field>
        </div>
      ) : null}
    </div>
  );
}

// Renames a question code everywhere this draft's rules use it.
function renameReferences(questions: EditorQuestion[], from: string, to: string) {
  return questions.map((q) => ({
    ...q,
    rules: q.rules.map((r) => ({
      ...r,
      comparisons: r.comparisons.map((c) => (c.question === from ? { ...c, question: to } : c)),
    })),
  }));
}

// Renames option codes in rules that compare with this question's options.
function renameOptions(
  questions: EditorQuestion[],
  key: string,
  before: EditorAnswer,
  after: EditorAnswer,
) {
  const renamed = new Map<string, string>();
  for (const option of after.options) {
    const old = before.options.find((o) => o.id === option.id);
    if (old?.code && old.code !== option.code) renamed.set(old.code, option.code);
  }
  if (!renamed.size) return questions;
  const swap = (value: string) => renamed.get(value) ?? value;
  return questions.map((q) => ({
    ...q,
    rules: q.rules.map((r) => ({
      ...r,
      comparisons: r.comparisons.map((c) =>
        c.question !== key
          ? c
          : {
              ...c,
              value: Array.isArray(c.value)
                ? c.value.map(swap)
                : typeof c.value === "string"
                  ? swap(c.value)
                  : c.value,
            },
      ),
    })),
  }));
}

// Which fields an inspector tab shows. "all" is the single-column layout.
export type QuestionSection = "question" | "answer" | "rules" | "all";

// The tab that holds an issue's field, so a problem link can open it.
export function sectionForField(field: string): Exclude<QuestionSection, "all"> {
  if (["label", "key", "prompt", "guidance"].includes(field)) return "question";
  if (field === "rules" || field.startsWith("rule:")) return "rules";
  return "answer";
}

export function QuestionFields({
  question,
  questions,
  kind,
  problems,
  onQuestionsChange,
  section = "all",
}: {
  question: EditorQuestion;
  questions: EditorQuestion[];
  kind: ObservationKind;
  problems: Map<string, string[]>;
  onQuestionsChange: (update: (questions: EditorQuestion[]) => EditorQuestion[]) => void;
  section?: QuestionSection;
}) {
  const show = (part: Exclude<QuestionSection, "all">) => section === "all" || section === part;
  const id = `q-${question.id}`;
  const identity = identityPolicy(kind, question.key);
  const policy = identityPolicies(kind).find((p) => p.key === question.key);
  const patch = (change: Partial<EditorQuestion>) =>
    onQuestionsChange((all) => all.map((q) => (q.id === question.id ? { ...q, ...change } : q)));
  const setKey = (key: string, lock: boolean) =>
    onQuestionsChange((all) =>
      renameReferences(all, question.key, key).map((q) =>
        q.id === question.id ? { ...q, key, keyLocked: lock || q.keyLocked } : q,
      ),
    );
  const setAnswer = (answer: EditorAnswer) =>
    onQuestionsChange((all) =>
      renameOptions(all, question.key, question.answer, answer).map((q) =>
        q.id === question.id ? { ...q, answer } : q,
      ),
    );
  return (
    <div className="space-y-6">
      {show("question") && identity && policy ? (
        <div className="flex gap-3 rounded-xl bg-bumper-deep px-4 py-3 text-sm text-white">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sky" />
          <p>
            <span className="font-semibold">Identity question. </span>
            {policy.explanation}
          </p>
        </div>
      ) : null}
      {show("question") ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={`${id}-label`}
              label="Label"
              hint="Short name admins and data users see."
              errors={problems.get("label")}
            >
              {(props) => (
                <Input
                  fullWidth
                  {...props}
                  className={input}
                  value={question.label}
                  maxLength={160}
                  onChange={(e) => {
                    const label = e.target.value;
                    if (question.keyLocked || identity) patch({ label });
                    else
                      onQuestionsChange((all) => {
                        const key = codeFromLabel(
                          label,
                          all.filter((q) => q.id !== question.id).map((q) => q.key),
                        );
                        return renameReferences(all, question.key, key).map((q) =>
                          q.id === question.id ? { ...q, label, key } : q,
                        );
                      });
                  }}
                />
              )}
            </Field>
            <Field
              id={`${id}-key`}
              label="Code"
              hint={
                identity
                  ? "Identity codes are fixed."
                  : "Stored with every answer and used by rules and the data API. Keep it once a version is in use; change the label instead."
              }
              errors={problems.get("key")}
            >
              {(props) => (
                <Input
                  fullWidth
                  {...props}
                  className={`${input} font-mono`}
                  value={question.key}
                  readOnly={Boolean(identity)}
                  spellCheck={false}
                  autoCapitalize="none"
                  onChange={(e) => setKey(e.target.value, true)}
                />
              )}
            </Field>
          </div>
          <Field
            id={`${id}-prompt`}
            label="Follow-up question"
            hint="Sent to the scout when this answer is missing or unclear."
            errors={problems.get("prompt")}
          >
            {(props) => (
              <TextArea
                fullWidth
                {...props}
                rows={2}
                className={textarea}
                value={question.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
              />
            )}
          </Field>
          <Field
            id={`${id}-guidance`}
            label="Extraction guidance"
            hint="Tells the AI how to read this answer from a scout’s message. Scouts never see it."
            errors={problems.get("guidance")}
          >
            {(props) => (
              <TextArea
                fullWidth
                {...props}
                rows={3}
                className={textarea}
                value={question.guidance}
                onChange={(e) => patch({ guidance: e.target.value })}
              />
            )}
          </Field>
        </>
      ) : null}
      {show("answer") ? (
        <div
          className={section === "all" ? "space-y-4 border-t border-separator pt-5" : "space-y-4"}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={`${id}-type`}
              label="Answer type"
              hint={identity ? "Identity answer types are fixed." : undefined}
              errors={problems.get("answer")}
            >
              {(props) => (
                <ChoiceSelect
                  {...props}
                  value={question.answer.type}
                  disabled={Boolean(identity)}
                  onChange={(type) => setAnswer({ ...question.answer, type: type as AnswerType })}
                  choices={(Object.keys(answerTypeLabels) as AnswerType[]).map((type) => ({
                    value: type,
                    label: answerTypeLabels[type],
                  }))}
                />
              )}
            </Field>
            <div className="space-y-1.5">
              <span className="block text-sm font-semibold" id={`${id}-required-label`}>
                Requirement
              </span>
              <Checkbox
                isSelected={question.required}
                isDisabled={identity === "required"}
                aria-describedby={`${id}-required-hint`}
                onChange={(required) => patch({ required })}
                className="flex min-h-11 items-center rounded-field border border-(--field-border) bg-field px-3 shadow-field data-[disabled=true]:bg-default"
              >
                <Checkbox.Content className="min-h-11 text-sm">
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  Required before the observation is complete
                </Checkbox.Content>
              </Checkbox>
              <p id={`${id}-required-hint`} className="text-sm text-muted">
                {identity === "required"
                  ? "Always required for this kind."
                  : "Rules below can change this for some answers."}
              </p>
              <ProblemList errors={problems.get("required") ?? []} />
            </div>
          </div>
          <AnswerEditor
            question={question}
            locked={Boolean(identity)}
            problems={problems}
            onChange={setAnswer}
          />
        </div>
      ) : null}
      {show("rules") ? (
        <div className={section === "all" ? "border-t border-separator pt-5" : undefined}>
          <RuleEditor
            question={question}
            questions={questions}
            kind={kind}
            problems={problems}
            onChange={(rules) => patch({ rules })}
          />
        </div>
      ) : null}
    </div>
  );
}
