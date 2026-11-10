"use client";

import type { RuleOutcome } from "@ai-scouting/scouting";
import { AlertTriangle, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ruleState } from "@/lib/specification-preview";
import { cn } from "@/lib/utils";

const ruleTones = {
  applies: ["bg-accent text-primary", "Applies"],
  does_not_apply: ["bg-muted text-muted-foreground", "Does not apply"],
  unknown: ["bg-warning-soft text-warning", "Not known yet"],
} as const;

// One rule with whether it applies to the current answers.
export function RuleLine({ outcome, sentence }: { outcome: RuleOutcome; sentence: string }) {
  const [tone, label] = ruleTones[ruleState(outcome)];
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span
        className={cn(
          "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold",
          tone,
        )}
      >
        {label}
      </span>
      <span className="text-muted-foreground [overflow-wrap:anywhere]">{sentence}</span>
    </li>
  );
}

// The follow-up the scout would receive, in the wording production writes.
export function FollowUpMessage({ question }: { question: string | null }) {
  if (!question)
    return (
      <p className="text-sm text-muted-foreground">
        No follow-up. The scout is not asked anything else.
      </p>
    );
  return (
    <figure className="space-y-1.5">
      <figcaption className="flex items-center gap-2 text-sm font-medium">
        <MessageSquareText aria-hidden="true" className="size-4 text-primary" />
        Follow-up the scout gets
      </figcaption>
      <blockquote className="max-w-[65ch] rounded-lg rounded-tl-sm bg-accent px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
        {question}
      </blockquote>
    </figure>
  );
}

// Preview and test need a contract that passes the publication checks.
export function FixProblemsFirst({
  count,
  action,
  onShowProblems,
}: {
  count: number;
  action: string;
  onShowProblems: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive-soft/60 p-5">
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle aria-hidden="true" className="size-4" />
        {count === 1 ? "Fix 1 problem" : `Fix ${count} problems`} to {action}
      </p>
      <p className="text-sm">
        {action === "preview answers" ? "The preview" : "The test"} uses the same checks as
        publishing, so it runs only on a draft that could be published.
      </p>
      <Button type="button" variant="outline" className="h-11" onClick={onShowProblems}>
        Show problems
      </Button>
    </div>
  );
}
