"use client";

import {
  type Contract,
  type ContractIssue,
  type ExtractionResult,
  LIMITS_DRAFT_TEST,
  type ObservationKind,
  sampleCasesFor,
} from "@ai-scouting/scouting";
import { AlertTriangle, Plus, Sparkles, X } from "lucide-react";
import { useId, useState } from "react";
import { type DraftTestMessage, testSpecificationDraft } from "@/app/admin/specification-actions";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { newId } from "@/lib/specification-model";
import {
  formatValue,
  latestStated,
  questionByKey,
  requirementLabel,
  stateView,
} from "@/lib/specification-preview";
import { cn } from "@/lib/utils";
import { ChoiceSelect } from "./choice-select";
import { controlClass } from "./fields";
import { FollowUpMessage } from "./preview-parts";

const textarea = `${controlClass} min-h-20 py-2.5 leading-relaxed`;

interface Message extends DraftTestMessage {
  id: string;
}

interface Outcome {
  revision: number;
  contract: Contract;
  messages: Message[];
  result: ExtractionResult;
}

const blankNote = (): Message => ({ id: newId("m"), role: "note", text: "" });

function Counter({ length, max }: { length: number; max: number }) {
  return (
    <span
      className={cn("tabular-nums", length > max ? "text-destructive" : "text-muted-foreground")}
    >
      {length.toLocaleString("en-CA")} / {max.toLocaleString("en-CA")}
    </span>
  );
}

function Results({ outcome, stale }: { outcome: Outcome; stale: boolean }) {
  const { contract, result } = outcome;
  const stated = latestStated(result);
  const complete = result.status === "complete";
  return (
    <section aria-labelledby="test-result" className="space-y-5 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="test-result" className="font-semibold">
          Result
        </h3>
        <StatusBadge tone={complete ? "success" : "warning"}>
          {complete ? "Complete" : "Needs follow-up"}
        </StatusBadge>
        <span className="text-sm text-muted-foreground">
          AI extraction of draft revision {outcome.revision}
        </span>
      </div>
      {stale ? (
        <p className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          The draft changed after this test. Run it again to test your changes.
        </p>
      ) : null}
      <FollowUpMessage question={result.question} />

      <div className="space-y-2">
        <h4 className="text-sm font-medium">What each message stated</h4>
        <ol className="space-y-3">
          {outcome.messages.map((message, index) => {
            const values = Object.entries(result.turns[index] ?? {});
            return (
              <li key={message.id} className="space-y-2 rounded-lg border px-4 py-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  {index === 0 ? "Note" : `Reply ${index}`}
                </p>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                  {message.text}
                </p>
                {values.length ? (
                  <dl className="flex flex-wrap gap-2 text-sm">
                    {values.map(([key, value]) => {
                      const question = questionByKey(contract, key);
                      return (
                        <div
                          key={key}
                          className="inline-flex gap-1.5 rounded-md bg-accent px-2.5 py-1"
                        >
                          <dt className="font-medium">{question?.label ?? key}:</dt>
                          <dd>{formatValue(question, value)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : (
                  <p className="text-sm italic text-muted-foreground">Nothing extracted.</p>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Answers after every message</h4>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Question
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Value
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {contract.questions.map((question) => {
                const field = result.fields[question.key];
                if (!field) return null;
                const has = Object.hasOwn(stated, question.key);
                const inactive = Object.hasOwn(result.inactive, question.key);
                const view = stateView(field);
                return (
                  <tr key={question.key} className="align-top">
                    <th scope="row" className="px-3 py-2.5 font-medium [overflow-wrap:anywhere]">
                      {question.label}
                      <span className="block font-normal text-muted-foreground">
                        {requirementLabel(field)}
                      </span>
                    </th>
                    <td className="px-3 py-2.5 [overflow-wrap:anywhere]">
                      {has ? (
                        formatValue(question, stated[question.key])
                      ) : (
                        <span className="text-muted-foreground">Not stated</span>
                      )}
                      {inactive ? (
                        <span className="block text-muted-foreground">
                          Kept as history; not used.
                        </span>
                      ) : null}
                      {field.problem ? (
                        <span className="block text-destructive">{field.problem}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// Model test (#49): runs the production extraction once on synthetic text, on an explicit
// action. The panel keeps its inputs whatever happens to the request.
export function ExtractionTest({
  organizationId,
  draftId,
  kind,
  contract,
  revision,
  dirty,
  prepare,
  onInvalid,
}: {
  organizationId: string;
  draftId: string;
  kind: ObservationKind;
  contract: Contract;
  // The saved revision and whether there are unsaved edits, to mark a result as out of date.
  revision: number;
  dirty: boolean;
  // Saves pending edits; resolves to the saved revision, or null with a reason.
  prepare: () => Promise<number | { error: string }>;
  onInvalid: (issues: ContractIssue[]) => void;
}) {
  const base = useId();
  const samples = sampleCasesFor(kind);
  const [messages, setMessages] = useState<Message[]>(() => [blankNote()]);
  const [sample, setSample] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const total = messages.reduce((sum, m) => sum + m.text.length + (m.asked?.length ?? 0), 0);
  const tooLong =
    total > LIMITS_DRAFT_TEST.total ||
    messages.some(
      (m) =>
        m.text.length > LIMITS_DRAFT_TEST.text || (m.asked?.length ?? 0) > LIMITS_DRAFT_TEST.asked,
    );
  const empty = messages.some((m) => !m.text.trim());

  const update = (id: string, patch: Partial<Message>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const loadSample = (id: string) => {
    setSample(id);
    const chosen = samples.find((s) => s.id === id);
    if (chosen) setMessages(chosen.messages.map((m) => ({ ...m, id: newId("m") })));
  };

  const run = async () => {
    setError(null);
    setRunning(true);
    try {
      const prepared = await prepare();
      if (typeof prepared !== "number") {
        setError(prepared.error);
        return;
      }
      const sent = messages.map((m) => ({
        ...m,
        text: m.text.trim(),
        asked: m.asked?.trim() || undefined,
      }));
      const response = await testSpecificationDraft(organizationId, draftId, {
        revision: prepared,
        messages: sent.map(({ role, asked, text }) =>
          asked ? { role, asked, text } : { role, text },
        ),
      });
      if (response.outcome === "tested")
        setOutcome({
          revision: response.revision,
          contract,
          messages: sent,
          result: response.result,
        });
      else if (response.outcome === "invalid") {
        setError(response.message);
        onInvalid(response.issues);
      } else setError(response.message);
    } catch {
      setError("The test did not run. Your sample is kept; try again shortly.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Test extraction</h2>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Runs the AI extraction used in live scouting on a sample note and replies, against this
          draft as saved. Each run makes one AI request. No scouting session is created, nothing is
          sent to Telegram and no version changes.
        </p>
      </div>

      <section
        aria-labelledby={`${base}-sample`}
        className="space-y-4 rounded-xl border bg-card p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id={`${base}-sample`} className="font-semibold">
            Sample messages
          </h3>
          <ChoiceSelect
            id={`${base}-load`}
            aria-label="Start from a sample"
            className="w-56"
            placeholder="Start from a sample…"
            value={sample}
            disabled={running}
            onChange={loadSample}
            choices={samples.map((s) => ({ value: s.id, label: s.title }))}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Use invented notes only. Do not paste real scout messages here.
          {sample ? ` ${samples.find((s) => s.id === sample)?.shows}` : ""}
        </p>
        <fieldset disabled={running} className="space-y-4">
          <legend className="sr-only">Messages</legend>
          {messages.map((message, index) => {
            const id = `${base}-${message.id}`;
            return (
              <div key={message.id} className={cn("space-y-2", index > 0 && "border-t pt-4")}>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`${id}-text`} className="text-sm font-medium">
                    {index === 0 ? "Scout’s note" : `Reply ${index}`}
                  </label>
                  {index > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 text-muted-foreground"
                      onClick={() => setMessages((list) => list.filter((m) => m.id !== message.id))}
                    >
                      <X aria-hidden="true" />
                      Remove reply
                    </Button>
                  ) : null}
                </div>
                {index > 0 ? (
                  <div className="space-y-1.5">
                    <label htmlFor={`${id}-asked`} className="text-sm text-muted-foreground">
                      Follow-up it answers (optional)
                    </label>
                    <input
                      id={`${id}-asked`}
                      className={`${controlClass} h-11`}
                      value={message.asked ?? ""}
                      placeholder="For example: Which level did the robot climb to?"
                      onChange={(e) => update(message.id, { asked: e.target.value })}
                    />
                  </div>
                ) : null}
                <textarea
                  id={`${id}-text`}
                  rows={index === 0 ? 3 : 2}
                  className={textarea}
                  value={message.text}
                  aria-describedby={`${id}-count`}
                  placeholder={
                    index === 0
                      ? "For example: Q14 team 1241 played, 3 in auto, climbed high."
                      : "For example: mid"
                  }
                  onChange={(e) => update(message.id, { text: e.target.value })}
                />
                <p id={`${id}-count`} className="text-right text-xs">
                  <Counter length={message.text.length} max={LIMITS_DRAFT_TEST.text} />
                </p>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={messages.length >= LIMITS_DRAFT_TEST.messages}
              onClick={() =>
                setMessages((list) => [
                  ...list,
                  {
                    id: newId("m"),
                    role: "reply",
                    asked: outcome?.result.question ?? "",
                    text: "",
                  },
                ])
              }
            >
              <Plus aria-hidden="true" />
              Add reply
            </Button>
            <span className="text-sm">
              <Counter length={total} max={LIMITS_DRAFT_TEST.total} /> characters in total
            </span>
          </div>
        </fieldset>
        {error ? (
          <p
            role="alert"
            className="flex gap-2 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="h-11 px-5 max-sm:w-full"
            disabled={running || empty || tooLong}
            onClick={run}
          >
            <Sparkles aria-hidden="true" />
            {running ? "Testing… this can take 30 seconds" : "Run test"}
          </Button>
          {empty && !running ? (
            <span className="text-sm text-muted-foreground">
              Write the note{messages.length > 1 ? " and every reply" : ""} to run the test.
            </span>
          ) : null}
        </div>
      </section>

      <div aria-live="polite">
        {outcome ? (
          <Results outcome={outcome} stale={dirty || revision !== outcome.revision} />
        ) : null}
      </div>
    </div>
  );
}
