import type {
  Contract,
  ExtractionResult,
  FieldState,
  Question,
  QuestionResult,
  RuleOutcome,
} from "@ai-scouting/scouting";
import type { StatusTone } from "@/components/status-badge";

// Plain-language views of the shared evaluator's results, for the draft preview and test (#49).
// Nothing here decides applicability or completeness; the shared package does.

export type SampleAnswers = Record<string, unknown>;

// Draft inputs keep what the admin typed. Numbers become numbers only when they parse, so a
// half-typed value is checked as invalid instead of disappearing.
export function answerFromInput(question: Question, input: string): unknown {
  if (question.answer.type !== "number") return input === "" ? null : input;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : trimmed;
}

const optionLabel = (question: Question | undefined, code: string) =>
  question &&
  (question.answer.type === "single_choice" || question.answer.type === "multiple_choice")
    ? (question.answer.options.find((o) => o.code === code)?.label ?? code)
    : code;

// One stated or stored value, the way an admin reads it.
export function formatValue(question: Question | undefined, value: unknown): string {
  if (value === null) return "Withdrawn or not known";
  if (value === undefined) return "Not stated";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length
      ? value.map((v) => (typeof v === "string" ? optionLabel(question, v) : String(v))).join(", ")
      : "None of these";
  if (typeof value === "string") return optionLabel(question, value);
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export interface StateView {
  tone: StatusTone;
  label: string;
}

// The answer state of one question. Unknown and inactive stay distinct from a missing answer.
export function stateView(field: Pick<FieldState, "state" | "requirement">): StateView {
  switch (field.state) {
    case "answered":
      return { tone: "success", label: "Answered" };
    case "missing":
      return { tone: "danger", label: "Missing" };
    case "invalid":
      return { tone: "danger", label: "Cannot use answer" };
    case "pending":
      return { tone: "waiting", label: "Waiting on another answer" };
    case "inactive":
      return { tone: "neutral", label: "Not asked" };
    case "unanswered":
      return { tone: "neutral", label: "Not answered" };
  }
}

export function requirementLabel(field: Pick<FieldState, "requirement">) {
  switch (field.requirement) {
    case "required":
      return "Required";
    case "optional":
      return "Optional";
    case "unknown":
      return "Required or optional: not known yet";
    case "not_applicable":
      return "Not applicable";
  }
}

export function visibilityLabel(field: Pick<FieldState, "visibility">) {
  switch (field.visibility) {
    case "visible":
      return "Asked";
    case "hidden":
      return "Not asked";
    case "unknown":
      return "Asked or not: not known yet";
  }
}

export type RuleState = "applies" | "does_not_apply" | "unknown";
export const ruleState = (outcome: RuleOutcome): RuleState =>
  outcome.holds === null ? "unknown" : outcome.holds ? "applies" : "does_not_apply";

// One sentence on why the question is or is not asked, and why it is required or optional.
export function explain(question: Question, result: QuestionResult): string[] {
  const rules = result.rules;
  const show = rules.filter((r) => r.effect === "show");
  const hide = rules.filter((r) => r.effect === "hide");
  const lines: string[] = [];
  if (result.visibility === "unknown")
    lines.push("Whether it is asked depends on an answer that is not known yet.");
  else if (result.visibility === "hidden")
    lines.push(
      show.length
        ? "Not asked: no “ask only when” rule applies."
        : "Not asked: a “do not ask when” rule applies.",
    );
  else if (show.length) lines.push("Asked: an “ask only when” rule applies.");
  else if (hide.length) lines.push("Asked: no “do not ask when” rule applies.");
  if (result.visibility !== "hidden") {
    const flips = rules.filter((r) => r.effect === "require" || r.effect === "optional");
    if (result.requirement === "unknown")
      lines.push("Whether it is required depends on an answer that is not known yet.");
    else if (flips.some((r) => r.holds === true))
      lines.push(
        question.required
          ? "Optional here: an “optional when” rule applies."
          : "Required here: a “required when” rule applies.",
      );
    else if (flips.length)
      lines.push(
        question.required
          ? "Required: no “optional when” rule applies."
          : "Optional: no “required when” rule applies.",
      );
  }
  return lines;
}

// The latest value each question received, including values production does not use.
export function latestStated(result: ExtractionResult): Record<string, unknown> {
  const latest: Record<string, unknown> = {};
  for (const [key, entries] of Object.entries(result.history)) {
    const last = entries.at(-1);
    if (last) latest[key] = last.value;
  }
  return latest;
}

export const questionByKey = (contract: Contract, key: string) =>
  contract.questions.find((q) => q.key === key);
