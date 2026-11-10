"use client";

import type { ObservationKind } from "@ai-scouting/scouting";
import { useState } from "react";
import {
  answerSummary,
  type EditorQuestion,
  identityPolicies,
  ruleSentence,
  toEditorQuestions,
} from "@/lib/specification-model";
import { QuestionList } from "./question-list";

function Details({
  question,
  questions,
  kind,
}: {
  question: EditorQuestion;
  questions: EditorQuestion[];
  kind: ObservationKind;
}) {
  const identity = identityPolicies(kind).find((p) => p.key === question.key);
  const rows: [string, React.ReactNode][] = [
    ["Label", question.label],
    [
      "Code",
      <code key="code" className="font-mono text-[0.8125rem]">
        {question.key}
      </code>,
    ],
    ["Follow-up question", question.prompt],
    ["Extraction guidance", question.guidance],
    ["Answer", answerSummary(question)],
    ["Requirement", question.required ? "Required" : "Optional"],
  ];
  if (question.answer.options.length)
    rows.push([
      "Options",
      <ul key="options" className="space-y-0.5">
        {question.answer.options.map((o) => (
          <li key={o.id}>
            {o.label}{" "}
            <code className="font-mono text-[0.8125rem] text-muted-foreground">{o.code}</code>
          </li>
        ))}
      </ul>,
    ]);
  rows.push([
    "Conditions",
    question.rules.length
      ? question.rules.map((r) => <p key={r.id}>{ruleSentence(r, questions)}</p>)
      : identity
        ? "Identity question: always asked."
        : "Always asked.",
  ]);
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-medium text-muted-foreground">{term}</dt>
          <dd className="[overflow-wrap:anywhere] whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A publication in the same outline as the editor, read-only.
export function PublishedQuestions({
  kind,
  questions: raw,
}: {
  kind: ObservationKind;
  questions: unknown[];
}) {
  const [questions] = useState(() => toEditorQuestions(raw));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <QuestionList
      kind={kind}
      questions={questions}
      selectedId={selectedId}
      onSelect={setSelectedId}
      renderBody={(question) => <Details question={question} questions={questions} kind={kind} />}
    />
  );
}
