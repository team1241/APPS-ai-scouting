"use client";

import type { ObservationKind } from "@ai-scouting/scouting";
import { ChevronDown, Lock } from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  answerSummary,
  dependencies,
  type EditorQuestion,
  identityPolicy,
  ruleSentence,
} from "@/lib/specification-model";
import { cn } from "@/lib/utils";

interface Line {
  from: number;
  to: number;
  lane: number;
  active: boolean;
}

// Gives each dependency a lane so overlapping spans sit side by side, shortest spans nearest
// the questions.
function lanes(questions: EditorQuestion[], selected: number) {
  const edges = dependencies(questions).sort(
    (a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from),
  );
  const used: [number, number][][] = [];
  return edges.map((edge): Line => {
    const top = Math.min(edge.from, edge.to);
    const bottom = Math.max(edge.from, edge.to);
    let lane = used.findIndex((spans) => spans.every(([a, b]) => bottom < a || top > b));
    if (lane === -1) lane = used.push([]) - 1;
    used[lane]?.push([top, bottom]);
    return { ...edge, lane, active: edge.from === selected || edge.to === selected };
  });
}

// The outline of questions, read the way scouts meet them. The gutter draws a line from each
// question to the questions whose rules depend on its answer; the text carries the same facts.
export function QuestionList({
  kind,
  questions,
  selectedId,
  onSelect,
  problems,
  renderBody,
  headerAction,
}: {
  kind: ObservationKind;
  questions: EditorQuestion[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  problems?: Map<string, number>;
  renderBody: (question: EditorQuestion, index: number) => ReactNode;
  headerAction?: (question: EditorQuestion) => ReactNode;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [positions, setPositions] = useState<number[]>([]);
  const measure = useCallback(() => {
    const root = list.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    const dots = [...root.querySelectorAll<HTMLElement>("[data-rule-dot]")];
    const next = dots.map((dot) => {
      const box = dot.getBoundingClientRect();
      return box.top - top + box.height / 2;
    });
    setPositions((previous) =>
      previous.length === next.length &&
      previous.every((p, i) => Math.abs(p - (next[i] ?? 0)) < 0.5)
        ? previous
        : next,
    );
  }, []);
  useLayoutEffect(() => {
    measure();
    const root = list.current;
    if (!root) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const child of root.children) observer.observe(child);
    return () => observer.disconnect();
  });
  const selectedIndex = questions.findIndex((q) => q.id === selectedId);
  const lines = lanes(questions, selectedIndex);
  const linked = new Set(lines.flatMap((l) => [l.from, l.to]));
  const height = list.current?.offsetHeight ?? 0;
  return (
    <div className="relative">
      <ol ref={list} className="space-y-2">
        {questions.map((question, index) => {
          const open = question.id === selectedId;
          const identity = identityPolicy(kind, question.key);
          const count = problems?.get(question.id) ?? 0;
          const bodyId = `question-${question.id}`;
          return (
            <li
              key={question.id}
              id={`block-${question.id}`}
              className={cn(
                "scroll-mt-[calc(var(--site-header-height)+var(--sub-header-height)+1rem)] rounded-xl border bg-card transition-[border-color,box-shadow]",
                open && "border-primary shadow-[0_0_0_1px_var(--color-primary)]",
              )}
            >
              <div className="flex items-start">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => onSelect(open ? null : question.id)}
                  className="group grid min-h-11 flex-1 grid-cols-[1.75rem_1.5rem_1fr] items-start gap-x-2 rounded-xl py-4 pr-2 pl-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid-cols-[2rem_1.5rem_1fr] sm:gap-x-3 sm:pl-5"
                >
                  <span className="pt-0.5 text-sm text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <span className="relative flex h-7 items-center justify-center">
                    <span
                      data-rule-dot
                      className={cn(
                        "size-3 rounded-full border-2",
                        linked.has(index)
                          ? index === selectedIndex
                            ? "border-primary bg-primary"
                            : "border-primary bg-card"
                          : "border-border bg-card",
                      )}
                    />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-lg leading-snug font-medium text-navy [overflow-wrap:anywhere]",
                        !question.prompt.trim() && "text-muted-foreground italic",
                      )}
                    >
                      {question.prompt.trim() || "No follow-up question yet"}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      <span className="font-medium text-foreground">
                        {question.label.trim() || "Untitled"}
                      </span>
                      {" · "}
                      <code className="font-mono text-[0.8125rem]">
                        {question.key || "no code"}
                      </code>
                      {" · "}
                      {answerSummary(question)}
                      {" · "}
                      {question.required ? "Required" : "Optional"}
                    </span>
                    {question.rules.map((rule) => (
                      <span key={rule.id} className="mt-1 block text-sm text-primary">
                        {ruleSentence(rule, questions)}
                      </span>
                    ))}
                    <span className="mt-2 flex flex-wrap gap-2 empty:hidden">
                      {identity ? (
                        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-navy px-2.5 text-xs font-semibold text-white">
                          <Lock aria-hidden="true" className="size-3 text-sky" />
                          Identity
                        </span>
                      ) : null}
                      {count ? (
                        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-destructive-soft px-2.5 text-xs font-semibold text-destructive">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                          {count === 1 ? "1 problem" : `${count} problems`}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
                <span className="flex items-center gap-1 py-3 pr-3">
                  {open && headerAction ? headerAction(question) : null}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "mt-1 size-5 text-muted-foreground transition-transform motion-reduce:transition-none",
                      open && "rotate-180",
                    )}
                  />
                </span>
              </div>
              {open ? (
                <div id={bodyId} className="border-t px-4 py-5 sm:pr-6 sm:pl-[4.75rem]">
                  {renderBody(question, index)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-12 z-10 w-6 overflow-visible sm:left-16"
        height={height}
      >
        {lines.map((line) => {
          const y1 = positions[line.from];
          const y2 = positions[line.to];
          if (y1 === undefined || y2 === undefined) return null;
          // Lanes step left from the dots, which sit at x = 12.
          const x = 4 - line.lane * 6;
          return (
            <path
              key={`${line.from}:${line.to}`}
              d={`M 12 ${y1} H ${x} V ${y2} H 12`}
              fill="none"
              strokeWidth={line.active ? 2.5 : 2}
              strokeLinejoin="round"
              className={line.active ? "stroke-primary" : "stroke-sky"}
            />
          );
        })}
      </svg>
    </div>
  );
}
