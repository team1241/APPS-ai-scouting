"use client";

import type { Contract, ObservationKind } from "@ai-scouting/scouting";
import { Button, Tabs } from "@heroui/react";
import { ArrowDown, ArrowUp, Copy, Trash2, X } from "lucide-react";
import type { Key } from "react";
import type { EditorQuestion } from "@/lib/specification-model";
import { QuestionFields, type QuestionSection, sectionForField } from "./question-fields";
import { TelegramView } from "./telegram-view";

type Tab = Exclude<QuestionSection, "all">;

// The selected question's settings beside the outline on wide screens: how it reaches
// scouts in Telegram, then its fields in Question, Answer and Rules tabs.
export function QuestionInspector({
  kind,
  question,
  index,
  questions,
  contract,
  problems,
  tab,
  onTabChange,
  onQuestionsChange,
  onMove,
  onDuplicate,
  onRemove,
  onClose,
}: {
  kind: ObservationKind;
  question: EditorQuestion;
  index: number;
  questions: EditorQuestion[];
  contract: Contract | null;
  problems: Map<string, string[]>;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onQuestionsChange: (update: (questions: EditorQuestion[]) => EditorQuestion[]) => void;
  onMove: (step: -1 | 1) => void;
  onDuplicate: () => void;
  // Null for a required identity question, which cannot be removed.
  onRemove: (() => void) | null;
  onClose: () => void;
}) {
  // Problem counts per tab, so a tab with an error shows it before it is opened.
  const counts: Record<Tab, number> = { question: 0, answer: 0, rules: 0 };
  for (const [field, messages] of problems) counts[sectionForField(field)] += messages.length;
  const labels: Record<Tab, string> = {
    question: "Question",
    answer: "Answer",
    rules: question.rules.length ? `Rules (${question.rules.length})` : "Rules",
  };
  const iconButton = "min-w-11 text-muted hover:text-foreground";
  return (
    <section
      id="question-inspector"
      aria-labelledby="inspector-title"
      className="rounded-2xl bg-surface shadow-surface"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <span className="font-bumper mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm text-accent-foreground">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted">
            Question {index + 1} of {questions.length}
          </p>
          <h3
            id="inspector-title"
            className="truncate text-base font-semibold"
            title={question.label || undefined}
          >
            {question.label.trim() || "Untitled question"}
          </h3>
        </div>
        <div className="-mr-2 flex shrink-0 items-center">
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Move up"
            isDisabled={index === 0}
            onPress={() => onMove(-1)}
            className={iconButton}
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </Button>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Move down"
            isDisabled={index === questions.length - 1}
            onPress={() => onMove(1)}
            className={iconButton}
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </Button>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Duplicate"
            onPress={onDuplicate}
            className={iconButton}
          >
            <Copy aria-hidden="true" className="size-4" />
          </Button>
          {onRemove ? (
            <Button
              isIconOnly
              variant="ghost"
              aria-label="Remove question"
              onPress={onRemove}
              className="min-w-11 text-danger hover:bg-danger-soft"
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Close question"
            onPress={onClose}
            className={iconButton}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
      {onRemove ? null : (
        <p className="-mt-1 px-5 pb-2 text-xs text-muted">
          Required identity questions cannot be removed.
        </p>
      )}

      <div className="px-5">
        <TelegramView kind={kind} question={question} questions={questions} contract={contract} />
      </div>

      <Tabs
        selectedKey={tab}
        onSelectionChange={(key: Key) => onTabChange(key as Tab)}
        className="px-5 pt-4 pb-5"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Question settings">
            {(Object.keys(labels) as Tab[]).map((value) => (
              <Tabs.Tab key={value} id={value}>
                {labels[value]}
                {counts[value] ? (
                  <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[0.6875rem] font-bold text-danger-foreground">
                    {counts[value]}
                    <span className="sr-only"> {counts[value] === 1 ? "problem" : "problems"}</span>
                  </span>
                ) : null}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {(Object.keys(labels) as Tab[]).map((value) => (
          <Tabs.Panel key={value} id={value} className="pt-5">
            <QuestionFields
              question={question}
              questions={questions}
              kind={kind}
              problems={problems}
              onQuestionsChange={onQuestionsChange}
              section={value}
            />
          </Tabs.Panel>
        ))}
      </Tabs>
    </section>
  );
}
