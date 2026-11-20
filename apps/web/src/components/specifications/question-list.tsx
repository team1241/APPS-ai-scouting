"use client";

import type { ObservationKind } from "@ai-scouting/scouting";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
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
  compact = false,
}: {
  kind: ObservationKind;
  questions: EditorQuestion[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  problems?: Map<string, number>;
  renderBody: (question: EditorQuestion, index: number) => ReactNode;
  headerAction?: (question: EditorQuestion) => ReactNode;
  // Wide-screen outline beside the inspector: tighter rows, and the selected
  // question opens in the inspector instead of in place.
  compact?: boolean;
}) {
  const list = useRef<HTMLOListElement>(null);
  // Each dot's vertical centre and left edge, relative to the list.
  const [positions, setPositions] = useState<{ y: number; left: number; wide: boolean }[]>([]);
  const measure = useCallback(() => {
    const root = list.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const dots = [...root.querySelectorAll<HTMLElement>("[data-rule-dot]")];
    const next = dots.map((dot) => {
      const box = dot.getBoundingClientRect();
      return {
        y: box.top - origin.top + box.height / 2,
        left: box.left - origin.left,
        // Phones show the number inside a larger dot.
        wide: box.width > 16,
      };
    });
    setPositions((previous) =>
      previous.length === next.length &&
      previous.every(
        (p, i) =>
          Math.abs(p.y - (next[i]?.y ?? 0)) < 0.5 && Math.abs(p.left - (next[i]?.left ?? 0)) < 0.5,
      )
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
          const bodyId = compact ? "question-inspector" : `question-${question.id}`;
          return (
            <li
              key={question.id}
              id={`block-${question.id}`}
              className={cn(
                "scroll-mt-[calc(var(--site-header-height)+var(--sub-header-height)+1rem)] rounded-2xl bg-surface shadow-surface transition-shadow motion-reduce:transition-none",
                open && "ring-2 ring-accent",
              )}
            >
              <div className="flex items-start">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => onSelect(open ? null : question.id)}
                  className={cn(
                    "group grid min-h-11 flex-1 cursor-pointer grid-cols-[1.5rem_1fr] items-start gap-x-3 rounded-2xl pr-2 pl-5 text-left outline-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/40 sm:grid-cols-[2rem_1.5rem_1fr] sm:gap-x-3 sm:pl-5",
                    compact ? "py-3" : "py-4",
                  )}
                >
                  {/* From sm up the number has its own column; phones put it inside the dot. */}
                  <span className="pt-0.5 text-sm font-semibold text-muted tabular-nums max-sm:hidden">
                    {index + 1}
                  </span>
                  <span className="relative flex h-7 items-center justify-center">
                    <span
                      data-rule-dot
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full border-2 text-[0.6875rem] font-bold tabular-nums sm:size-3",
                        linked.has(index)
                          ? index === selectedIndex
                            ? "border-accent bg-accent text-accent-foreground"
                            : "border-accent bg-surface text-accent-soft-foreground"
                          : "border-border-secondary bg-surface text-muted",
                      )}
                    >
                      <span aria-hidden="true" className="sm:hidden">
                        {index + 1}
                      </span>
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block leading-snug font-semibold text-foreground [overflow-wrap:anywhere]",
                        compact ? "text-[0.9375rem]" : "text-lg",
                        !question.prompt.trim() && "font-medium text-muted italic",
                      )}
                    >
                      {question.prompt.trim() || "No follow-up question yet"}
                    </span>
                    <span className="mt-1 block text-sm text-muted [overflow-wrap:anywhere]">
                      <span className="font-medium text-foreground">
                        {question.label.trim() || "Untitled"}
                      </span>
                      {" · "}
                      <code className="font-mono text-[0.8125rem]">
                        {question.key || "no code"}
                      </code>
                      {compact ? null : (
                        <>
                          {" · "}
                          {answerSummary(question)}
                          {" · "}
                          {question.required ? "Required" : "Optional"}
                        </>
                      )}
                    </span>
                    {question.rules.map((rule) => (
                      <span
                        key={rule.id}
                        className={cn(
                          "mt-1 block font-medium text-accent-soft-foreground",
                          compact ? "text-xs" : "text-sm",
                        )}
                      >
                        {ruleSentence(rule, questions)}
                      </span>
                    ))}
                    <span className="mt-2 flex flex-wrap gap-2 empty:hidden">
                      {identity ? (
                        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-bumper-deep px-2.5 text-xs font-bold text-white">
                          <Lock aria-hidden="true" className="size-3 text-sky" />
                          Identity
                        </span>
                      ) : null}
                      {count ? (
                        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-danger-soft px-2.5 text-xs font-bold text-danger-soft-foreground">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                          {count === 1 ? "1 problem" : `${count} problems`}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
                <span className="flex items-center gap-1 py-3 pr-3">
                  {open && headerAction ? headerAction(question) : null}
                  {compact ? (
                    // Opens in the inspector beside the list, not in place.
                    <ChevronRight
                      aria-hidden="true"
                      className={cn("mt-1 size-5", open ? "text-accent" : "text-muted")}
                    />
                  ) : (
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "mt-1 size-5 text-muted transition-transform motion-reduce:transition-none",
                        open && "rotate-180",
                      )}
                    />
                  )}
                </span>
              </div>
              {open && !compact ? (
                // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the open question from any of its fields.
                <div
                  id={bodyId}
                  className="border-t border-separator px-4 py-5 sm:pr-6 sm:pl-[4.75rem]"
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || event.defaultPrevented) return;
                    event.preventDefault();
                    onSelect(null);
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLElement>(`[aria-controls="${bodyId}"]`)?.focus(),
                    );
                  }}
                >
                  {renderBody(question, index)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-10 w-px overflow-visible"
        height={height}
      >
        {lines.map((line) => {
          const from = positions[line.from];
          const to = positions[line.to];
          if (!from || !to) return null;
          // Lines leave each dot's left edge; lanes step further left, tighter on phones.
          const x = from.left - 4 - line.lane * (from.wide ? 5 : 6);
          return (
            <path
              key={`${line.from}:${line.to}`}
              d={`M ${from.left} ${from.y} H ${x} V ${to.y} H ${to.left}`}
              fill="none"
              strokeWidth={line.active ? 2.5 : 2}
              strokeLinejoin="round"
              className={line.active ? "stroke-accent" : "stroke-sky"}
            />
          );
        })}
      </svg>
    </div>
  );
}
