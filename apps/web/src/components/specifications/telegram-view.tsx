"use client";

import {
  type Contract,
  type Evaluation,
  finalizeWithEvaluation,
  followUpQuestion,
  type ObservationKind,
  sampleCasesFor,
} from "@ai-scouting/scouting";
import { MessageCircle } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { type EditorQuestion, identityPolicy, ruleSentence } from "@/lib/specification-model";
import { cn } from "@/lib/utils";
import { ChoiceSelect } from "./choice-select";

// Matches the bot's reply to a complete observation (apps/backend/src/extraction-reply.ts).
const savedReply = "Saved! Thanks for scouting.";

type Mode = "question" | "example";

// The bot's message, with the selected question's sentence marked.
function BotBubble({ text, prompt }: { text: string; prompt: string }) {
  const at = prompt ? text.indexOf(prompt) : -1;
  return (
    <p className="max-w-[88%] self-start rounded-2xl rounded-bl-md bg-surface px-3.5 py-2.5 text-sm shadow-sm">
      {at === -1 ? (
        text
      ) : (
        <>
          <span className="text-muted">{text.slice(0, at)}</span>
          <mark className="rounded bg-warning-soft px-0.5 text-foreground ring-1 ring-warning/50">
            {prompt}
          </mark>
          <span className="text-muted">{text.slice(at + prompt.length)}</span>
        </>
      )}
    </p>
  );
}

function ScoutBubble({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[88%] self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-sm text-accent-foreground">
      {children}
    </p>
  );
}

function Chip({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        quiet ? "bg-default text-muted" : "bg-accent-soft text-accent-soft-foreground",
      )}
    >
      {children}
    </span>
  );
}

// How the selected question reaches a scout in Telegram. The bot never walks through
// questions one by one: it replies once with every missing answer bundled, so one
// message shows the question in context without any earlier history.
export function TelegramView({
  kind,
  question,
  questions,
  contract,
}: {
  kind: ObservationKind;
  question: EditorQuestion;
  questions: EditorQuestion[];
  // The validated draft, or null while it has problems.
  contract: Contract | null;
}) {
  const [mode, setMode] = useState<Mode>("question");
  const prompt = question.prompt.trim();
  const identity = identityPolicy(kind, question.key);
  const canBeRequired =
    question.required || question.rules.some((rule) => rule.effect === "require");

  // The bot's message when this is the only missing answer, built by the same code as production.
  const message = useMemo(() => {
    if (!prompt) return null;
    const evaluation = {
      status: "incomplete",
      questions: [],
      followUps: [{ key: question.key, prompt, reason: "missing", identity: Boolean(identity) }],
    } as unknown as Evaluation;
    return followUpQuestion({ kind, questions: [] } as unknown as Contract, evaluation);
  }, [identity, kind, prompt, question.key]);

  const samples = sampleCasesFor(kind);
  // Prefer a sample whose follow-up asks this question, then one that answers it.
  const preferred =
    samples.find((s) => s.turns.slice(1).some((turn) => question.key in turn)) ??
    samples.find((s) => s.turns.some((turn) => question.key in turn)) ??
    samples[0];
  const [sampleId, setSampleId] = useState<string | null>(null);
  const sample = samples.find((s) => s.id === sampleId) ?? preferred;

  const exchange = useMemo(() => {
    if (!contract || !sample) return null;
    return sample.messages.map((m, index) => {
      const { result } = finalizeWithEvaluation(contract, sample.turns.slice(0, index + 1));
      return {
        scout: m.text,
        bot: result.status === "complete" ? savedReply : (result.question ?? null),
      };
    });
  }, [contract, sample]);

  return (
    <section aria-label="How scouts see this in Telegram" className="rounded-2xl bg-default p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-muted">
          <MessageCircle aria-hidden="true" className="size-3.5" />
          In Telegram
        </span>
        <div className="ml-auto inline-flex rounded-full bg-surface p-0.5 text-xs font-semibold shadow-sm">
          {(
            [
              ["question", "This question"],
              ["example", "Full example"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className="min-h-8 cursor-pointer rounded-full px-3 text-muted transition-colors hover:text-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground motion-reduce:transition-none"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="mt-3 flex flex-col gap-2">
        {mode === "question" ? (
          !prompt ? (
            <p className="text-sm text-muted">
              Write the follow-up question to see how scouts get it.
            </p>
          ) : !canBeRequired ? (
            <>
              <p className="text-sm text-muted">
                Optional, so the bot never asks for it. Scouts can still include it in their note.
              </p>
              {question.rules.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {question.rules.map((rule) => (
                    <Chip key={rule.id}>{ruleSentence(rule, questions)}</Chip>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              {message ? <BotBubble text={message} prompt={prompt} /> : null}
              <div className="flex flex-wrap gap-1.5">
                {identity ? <Chip>Asked first, on its own</Chip> : null}
                {question.required ? (
                  <Chip quiet>Asked when the note doesn’t answer it</Chip>
                ) : null}
                {question.rules.map((rule) => (
                  <Chip key={rule.id}>{ruleSentence(rule, questions)}</Chip>
                ))}
              </div>
              <p className="text-xs text-muted">
                Other missing answers follow in the same message, in outline order.
              </p>
            </>
          )
        ) : !contract ? (
          <p className="text-sm text-muted">Fix the draft’s problems to replay a full example.</p>
        ) : exchange && sample ? (
          <>
            {exchange.map((turn, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a sample's messages never reorder.
              <div key={index} className="flex flex-col gap-2">
                <ScoutBubble>{turn.scout}</ScoutBubble>
                {turn.bot ? <BotBubble text={turn.bot} prompt={prompt} /> : null}
              </div>
            ))}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <ChoiceSelect
                id={`telegram-sample-${question.id}`}
                aria-label="Sample exchange"
                value={sample.id}
                onChange={setSampleId}
                choices={samples.map((s) => ({ value: s.id, label: s.title }))}
                className="min-w-48 flex-1 sm:flex-none"
              />
              <p className="flex-1 basis-56 text-xs text-muted">
                Invented sample from the worked example. Its answers fill only questions with the
                same code.
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">No sample exchange for this kind yet.</p>
        )}
      </div>
    </section>
  );
}
