import {
  type Comparison,
  type Condition,
  type Contract,
  comparisons,
  isIdentityKey,
  type Question,
  type RuleEffect,
} from "./contract.ts";

export type AnswerValue = string | number | boolean | string[];

export type AnswerCheck =
  | { status: "known"; value: AnswerValue }
  | { status: "unknown" }
  | { status: "invalid"; reason: string };

const unknown = { status: "unknown" } as const;
const invalid = (reason: string): AnswerCheck => ({ status: "invalid", reason });

// Validate one answer against its question. Missing is unknown; nothing is coerced into a valid value.
export function checkAnswer(question: Question, value: unknown): AnswerCheck {
  if (value === null || value === undefined) return unknown;
  const { answer } = question;
  switch (answer.type) {
    case "text": {
      if (typeof value !== "string") return invalid("Expected text");
      const text = value.trim();
      if (!text) return unknown;
      if (answer.maxLength !== undefined && text.length > answer.maxLength)
        return invalid(`Longer than ${answer.maxLength} characters`);
      return { status: "known", value: text };
    }
    case "boolean":
      return typeof value === "boolean"
        ? { status: "known", value }
        : invalid("Expected true or false");
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return invalid("Expected a number");
      if (answer.format === "integer" && !Number.isInteger(value))
        return invalid("Expected a whole number");
      if (answer.min !== undefined && value < answer.min) return invalid(`Less than ${answer.min}`);
      if (answer.max !== undefined && value > answer.max) return invalid(`More than ${answer.max}`);
      return { status: "known", value };
    }
    case "single_choice":
      return typeof value === "string" && answer.options.some((o) => o.code === value)
        ? { status: "known", value }
        : invalid("Not one of the options");
    case "multiple_choice": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
        return invalid("Expected a list of options");
      const codes = new Set(answer.options.map((o) => o.code));
      if (value.some((v) => !codes.has(v))) return invalid("Not one of the options");
      if (new Set(value).size !== value.length) return invalid("Repeats an option");
      const min = answer.minSelected ?? 0;
      const max = answer.maxSelected ?? answer.options.length;
      if (value.length < min) return invalid(`Select at least ${min}`);
      if (value.length > max) return invalid(`Select at most ${max}`);
      // An empty list is an explicit "none of these"; unknown is null.
      return { status: "known", value: [...value] };
    }
  }
}

// Three-valued logic: true, false or null (unknown).
type Truth = boolean | null;
const or = (values: Truth[]): Truth =>
  values.includes(true) ? true : values.includes(null) ? null : false;
const and = (values: Truth[]): Truth =>
  values.includes(false) ? false : values.includes(null) ? null : true;
const not = (value: Truth): Truth => (value === null ? null : !value);

export type Visibility = "visible" | "hidden" | "unknown";
export type Requirement = "required" | "optional" | "unknown" | "not_applicable";
export type QuestionState =
  | "answered"
  | "unanswered"
  | "missing"
  | "invalid"
  | "pending"
  | "inactive";
export type FollowUpReason = "missing" | "invalid" | "prerequisite";

export interface QuestionResult {
  key: string;
  visibility: Visibility;
  requirement: Requirement;
  state: QuestionState;
  value: AnswerValue | null;
  problem?: string;
  // True when this question stops the observation from being complete.
  blocking: boolean;
}

export interface FollowUp {
  key: string;
  prompt: string;
  reason: FollowUpReason;
  identity: boolean;
}

export interface Evaluation {
  version: string;
  questions: QuestionResult[];
  // Active, valid answers only. This is what completeness and export use.
  current: Record<string, AnswerValue>;
  // Answers to hidden questions. Kept for history, never current.
  inactive: Record<string, unknown>;
  missing: string[];
  followUps: FollowUp[];
  status: "complete" | "incomplete";
}

// Deterministic evaluation of one set of answers against a validated contract.
export function evaluateAnswers(contract: Contract, values: Record<string, unknown>): Evaluation {
  const byKey = new Map(contract.questions.map((q) => [q.key, q]));
  const checks = new Map(
    contract.questions.map((q) => [
      q.key,
      checkAnswer(q, Object.hasOwn(values, q.key) ? values[q.key] : null),
    ]),
  );
  const visibilityMemo = new Map<string, Truth>();
  const rulesFor = (question: Question, effects: RuleEffect[]) =>
    (question.rules ?? []).filter((r) => effects.includes(r.effect));

  // A condition on a hidden question is false: hidden answers are not applicable.
  const leaf = (comparison: Comparison): Truth => {
    const upstream = byKey.get(comparison.question);
    if (!upstream) return null;
    const visible = visibility(upstream);
    if (visible !== true) return visible;
    const check = checks.get(upstream.key);
    if (check?.status !== "known") return null;
    const actual = check.value;
    const expected = comparison.value;
    switch (comparison.operator) {
      case "equals":
        return actual === expected;
      case "not_equals":
        return actual !== expected;
      case "lt":
        return (actual as number) < (expected as number);
      case "lte":
        return (actual as number) <= (expected as number);
      case "gt":
        return (actual as number) > (expected as number);
      case "gte":
        return (actual as number) >= (expected as number);
      case "in":
        return (expected as string[]).includes(actual as string);
      case "not_in":
        return !(expected as string[]).includes(actual as string);
      case "includes":
        return (actual as string[]).includes(expected as string);
      case "excludes":
        return !(actual as string[]).includes(expected as string);
    }
  };
  const condition = (c: Condition): Truth =>
    "all" in c ? and(c.all.map(condition)) : "any" in c ? or(c.any.map(condition)) : leaf(c);

  // Rules of the same effect combine with "any". A question has show rules or hide rules, not both.
  function visibility(question: Question): Truth {
    if (visibilityMemo.has(question.key)) return visibilityMemo.get(question.key) as Truth;
    visibilityMemo.set(question.key, null); // Cycle guard; validated contracts are acyclic.
    const show = rulesFor(question, ["show"]);
    const hide = rulesFor(question, ["hide"]);
    const result = show.length
      ? or(show.map((r) => condition(r.when)))
      : hide.length
        ? not(or(hide.map((r) => condition(r.when))))
        : true;
    visibilityMemo.set(question.key, result);
    return result;
  }
  // Base requirement flips only through the opposing effect, so require and optional never conflict.
  const required = (question: Question): Truth => {
    const flips = rulesFor(question, [question.required ? "optional" : "require"]);
    const flip = flips.length ? or(flips.map((r) => condition(r.when))) : false;
    return flip === null ? null : question.required !== flip;
  };

  // Walk up unknown dependencies until reaching visible questions that can be asked directly.
  const prerequisites = (
    question: Question,
    effects: RuleEffect[],
    found: Set<string>,
    seen: Set<string>,
  ) => {
    for (const rule of rulesFor(question, effects))
      for (const { comparison } of comparisons(rule.when, [])) {
        const upstream = byKey.get(comparison.question);
        if (!upstream || seen.has(upstream.key)) continue;
        seen.add(upstream.key);
        const visible = visibility(upstream);
        if (visible === null) prerequisites(upstream, ["show", "hide"], found, seen);
        else if (visible && checks.get(upstream.key)?.status !== "known") found.add(upstream.key);
      }
  };

  const results: QuestionResult[] = [];
  const asks = new Map<string, FollowUpReason>();
  const ask = (key: string, reason: FollowUpReason) => {
    if (!asks.has(key) || reason !== "prerequisite") asks.set(key, reason);
  };
  const current: Record<string, AnswerValue> = {};
  const inactive: Record<string, unknown> = {};
  for (const question of contract.questions) {
    const check = checks.get(question.key) as AnswerCheck;
    const visible = visibility(question);
    const value = check.status === "known" ? check.value : null;
    const problem = check.status === "invalid" ? check.reason : undefined;
    const base = { key: question.key, value, ...(problem ? { problem } : {}) };
    if (visible === false) {
      if (values[question.key] !== null && values[question.key] !== undefined)
        inactive[question.key] = values[question.key];
      results.push({
        ...base,
        visibility: "hidden",
        requirement: "not_applicable",
        state: "inactive",
        blocking: false,
      });
      continue;
    }
    const need = required(question);
    const requirement: Requirement = need === null ? "unknown" : need ? "required" : "optional";
    const found = new Set<string>();
    let state: QuestionState;
    let blocking: boolean;
    if (visible === null) {
      // Applicability is unknown. Block only if an answer exists or the question could be required.
      blocking = check.status !== "unknown" || need !== false;
      state = blocking ? "pending" : "unanswered";
      if (blocking) {
        prerequisites(question, ["show", "hide"], found, new Set());
        if (need === null) prerequisites(question, ["require", "optional"], found, new Set());
      }
    } else if (check.status === "known") {
      state = "answered";
      blocking = false;
      current[question.key] = check.value;
    } else if (need === false) {
      state = check.status === "invalid" ? "invalid" : "unanswered";
      blocking = false;
    } else {
      state = check.status === "invalid" ? "invalid" : need ? "missing" : "pending";
      blocking = true;
      if (need === null) prerequisites(question, ["require", "optional"], found, new Set());
      // Asking the question itself also resolves an unknown requirement.
      ask(question.key, check.status === "invalid" ? "invalid" : "missing");
    }
    for (const key of found) ask(key, "prerequisite");
    results.push({
      ...base,
      visibility: visible ? "visible" : "unknown",
      requirement,
      state,
      blocking,
    });
  }
  const order = (key: string) => contract.questions.findIndex((q) => q.key === key);
  const followUps = [...asks]
    .map(([key, reason]) => ({
      key,
      prompt: (byKey.get(key) as Question).prompt,
      reason,
      identity: isIdentityKey(key),
    }))
    // Identity first, then contract order.
    .sort((a, b) => Number(b.identity) - Number(a.identity) || order(a.key) - order(b.key));
  return {
    version: contract.version,
    questions: results,
    current,
    inactive,
    missing: results
      .filter((r) => r.state === "missing" || (r.blocking && r.state === "invalid"))
      .map((r) => r.key),
    followUps,
    status: results.some((r) => r.blocking) ? "incomplete" : "complete",
  };
}

export type HistoryStatus = "active" | "superseded" | "inactive";
export interface HistoryEntry {
  turn: number;
  value: unknown;
  status: HistoryStatus;
}
export interface TurnFold {
  evaluation: Evaluation;
  history: Record<string, HistoryEntry[]>;
}

// Fold ordered turns (the initial note, then each linked reply or correction). Each turn holds only
// the values stated in that turn; null retracts an earlier answer. Rules are re-evaluated after
// every turn. When a question is hidden, every answer stated up to that turn becomes inactive
// history. If the question is shown again, it starts unknown: only a value stated in the
// reactivating turn or later can become current.
export function foldTurns(contract: Contract, turns: Record<string, unknown>[]): TurnFold {
  const keys = new Set(contract.questions.map((q) => q.key));
  const statements = new Map<string, { turn: number; value: unknown }[]>();
  const staleBefore = new Map<string, number>();
  const effective = () => {
    const values: Record<string, unknown> = {};
    for (const [key, list] of statements) {
      const latest = list.at(-1);
      if (latest && latest.turn >= (staleBefore.get(key) ?? 0)) values[key] = latest.value;
    }
    return values;
  };
  let evaluation = evaluateAnswers(contract, {});
  for (const [turn, stated] of turns.entries()) {
    for (const [key, value] of Object.entries(stated)) {
      if (!keys.has(key) || value === undefined) continue;
      statements.set(key, [...(statements.get(key) ?? []), { turn, value }]);
    }
    evaluation = evaluateAnswers(contract, effective());
    for (const result of evaluation.questions)
      if (result.visibility === "hidden") staleBefore.set(result.key, turn + 1);
  }
  // Report inactive history for hidden questions and stale answers awaiting a fresh statement.
  const inactive: Record<string, unknown> = {};
  const history: Record<string, HistoryEntry[]> = {};
  const hidden = new Set(
    evaluation.questions.filter((r) => r.visibility === "hidden").map((r) => r.key),
  );
  for (const [key, list] of statements) {
    const stale = staleBefore.get(key) ?? 0;
    history[key] = list.map((entry, i) => ({
      turn: entry.turn,
      value: entry.value,
      status:
        i < list.length - 1
          ? "superseded"
          : hidden.has(key) || entry.turn < stale
            ? "inactive"
            : "active",
    }));
    const latest = list.at(-1);
    if (latest && latest.value !== null && (hidden.has(key) || latest.turn < stale))
      inactive[key] = latest.value;
  }
  return { evaluation: { ...evaluation, inactive }, history };
}
