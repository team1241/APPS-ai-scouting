import {
  type AnswerType,
  CONTRACT_FORMAT_VERSION,
  type ComparisonOperator,
  type ContractIssue,
  type IdentityKey,
  identityContracts,
  isIdentityKey,
  LIMITS,
  type ObservationKind,
  operatorsByType,
  type RuleEffect,
  validateContract,
} from "@ai-scouting/scouting";

// The builder edits a loose copy of the contract. Every field keeps what the admin typed,
// even when it is not valid yet, so nothing is lost on save or on a failed request.

export interface EditorOption {
  id: string;
  code: string;
  label: string;
  // Codes follow the label until the admin edits the code, or once the option is saved.
  codeLocked: boolean;
}

export type ComparisonValue = boolean | string | string[] | null;

export interface EditorComparison {
  id: string;
  question: string;
  operator: ComparisonOperator | "";
  // Numbers stay text until serialized, so a half-typed value is kept.
  value: ComparisonValue;
}

export interface EditorRule {
  id: string;
  effect: RuleEffect;
  match: "all" | "any";
  comparisons: EditorComparison[];
  // A nested condition the plain-language editor cannot show. It is kept as written.
  nested?: unknown;
}

export interface EditorAnswer {
  type: AnswerType;
  format: "integer" | "decimal";
  min: string;
  max: string;
  maxLength: string;
  options: EditorOption[];
  minSelected: string;
  maxSelected: string;
}

export interface EditorQuestion {
  id: string;
  key: string;
  label: string;
  prompt: string;
  guidance: string;
  required: boolean;
  answer: EditorAnswer;
  rules: EditorRule[];
  keyLocked: boolean;
}

export interface EditorIssue {
  questionId?: string;
  // "key", "label", "prompt", "guidance", "required", "answer", "options",
  // `option:<id>`, `rule:<id>`, "rules", "description" or "questions".
  field: string;
  message: string;
}

export const kindLabels: Record<ObservationKind, string> = {
  match: "Match",
  pit: "Pit",
  general: "General",
};

export const answerTypeLabels: Record<AnswerType, string> = {
  text: "Free text",
  number: "Number",
  boolean: "Yes or no",
  single_choice: "One choice",
  multiple_choice: "Several choices",
};

export const effectLabels: Record<RuleEffect, string> = {
  show: "Ask this question only when",
  hide: "Do not ask this question when",
  require: "Make this question required when",
  optional: "Make this question optional when",
};

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++counter}`;

const record = (input: unknown): Record<string, unknown> =>
  input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const numberText = (value: unknown) =>
  typeof value === "number" ? String(value) : typeof value === "string" ? value : "";

const answerTypes: AnswerType[] = ["text", "number", "boolean", "single_choice", "multiple_choice"];

function toComparison(input: unknown): EditorComparison | null {
  const value = record(input);
  if (!("question" in value)) return null;
  const raw = value.value;
  return {
    id: newId("c"),
    question: text(value.question),
    operator: typeof value.operator === "string" ? (value.operator as ComparisonOperator) : "",
    value:
      typeof raw === "number"
        ? String(raw)
        : typeof raw === "boolean" || typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw.filter((v): v is string => typeof v === "string")
            : null,
  };
}

function toRule(input: unknown): EditorRule {
  const value = record(input);
  const effect = (["show", "hide", "require", "optional"] as const).includes(
    value.effect as RuleEffect,
  )
    ? (value.effect as RuleEffect)
    : "show";
  const when = record(value.when);
  const single = toComparison(when);
  if (single) return { id: newId("r"), effect, match: "all", comparisons: [single] };
  const match = Array.isArray(when.any) ? "any" : "all";
  const list = Array.isArray(when[match]) ? (when[match] as unknown[]) : [];
  const comparisons = list.map(toComparison);
  if (list.length && comparisons.every((c): c is EditorComparison => c !== null))
    return { id: newId("r"), effect, match, comparisons };
  return { id: newId("r"), effect, match, comparisons: [], nested: value.when };
}

export function toEditorQuestion(input: unknown): EditorQuestion {
  const value = record(input);
  const answer = record(value.answer);
  const type = answerTypes.includes(answer.type as AnswerType)
    ? (answer.type as AnswerType)
    : "text";
  const options = Array.isArray(answer.options) ? answer.options : [];
  return {
    id: newId("q"),
    key: text(value.key),
    label: text(value.label),
    prompt: text(value.prompt),
    guidance: text(value.guidance),
    required: value.required === true,
    answer: {
      type,
      format: answer.format === "decimal" ? "decimal" : "integer",
      min: numberText(answer.min),
      max: numberText(answer.max),
      maxLength: numberText(answer.maxLength),
      options: options.map((option) => ({
        id: newId("o"),
        code: text(record(option).code),
        label: text(record(option).label),
        codeLocked: true,
      })),
      minSelected: numberText(answer.minSelected),
      maxSelected: numberText(answer.maxSelected),
    },
    rules: Array.isArray(value.rules) ? value.rules.map(toRule) : [],
    keyLocked: true,
  };
}

export const toEditorQuestions = (questions: unknown[]) => questions.map(toEditorQuestion);

// Empty text stays out; anything else that is not a finite number is sent as typed, so
// validation rejects it instead of the value silently disappearing.
function serializeNumber(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : trimmed;
}

function serializeComparison(comparison: EditorComparison, questions: EditorQuestion[]) {
  const upstream = questions.find((q) => q.key === comparison.question);
  let value: unknown = comparison.value;
  if (upstream?.answer.type === "number" && typeof value === "string")
    value = serializeNumber(value) ?? null;
  return { question: comparison.question, operator: comparison.operator, value };
}

export function serializeRule(rule: EditorRule, questions: EditorQuestion[]) {
  if (rule.nested !== undefined) return { effect: rule.effect, when: rule.nested };
  const items = rule.comparisons.map((c) => serializeComparison(c, questions));
  return {
    effect: rule.effect,
    when: items.length === 1 ? items[0] : { [rule.match]: items },
  };
}

export function serializeQuestion(question: EditorQuestion, questions: EditorQuestion[]) {
  const { answer } = question;
  const bounds = (entries: [string, string][]) =>
    Object.fromEntries(
      entries
        .map(([name, value]) => [name, serializeNumber(value)] as const)
        .filter(([, value]) => value !== undefined),
    );
  const options = answer.options.map((o) => ({ code: o.code, label: o.label }));
  const serialized =
    answer.type === "number"
      ? {
          type: "number",
          format: answer.format,
          ...bounds([
            ["min", answer.min],
            ["max", answer.max],
          ]),
        }
      : answer.type === "text"
        ? { type: "text", ...bounds([["maxLength", answer.maxLength]]) }
        : answer.type === "boolean"
          ? { type: "boolean" }
          : answer.type === "single_choice"
            ? { type: "single_choice", options }
            : {
                type: "multiple_choice",
                options,
                ...bounds([
                  ["minSelected", answer.minSelected],
                  ["maxSelected", answer.maxSelected],
                ]),
              };
  return {
    key: question.key,
    label: question.label,
    prompt: question.prompt,
    guidance: question.guidance,
    required: question.required,
    answer: serialized,
    ...(question.rules.length
      ? { rules: question.rules.map((r) => serializeRule(r, questions)) }
      : {}),
  };
}

export const serializeQuestions = (questions: EditorQuestion[]) =>
  questions.map((q) => serializeQuestion(q, questions));

// Codes: lowercase letters, digits and underscores, starting with a letter.
export const codePattern = /^[a-z][a-z0-9_]*$/;

export function codeFromLabel(label: string, taken: Iterable<string>, fallback = "question") {
  let base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  if (!base) base = fallback;
  if (!/^[a-z]/.test(base)) base = `${fallback}_${base}`.slice(0, 56);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

export function blankQuestion(questions: EditorQuestion[]): EditorQuestion {
  return {
    id: newId("q"),
    key: codeFromLabel(
      "",
      questions.map((q) => q.key),
    ),
    label: "",
    prompt: "",
    guidance: "",
    required: false,
    answer: {
      type: "text",
      format: "integer",
      min: "",
      max: "",
      maxLength: "",
      options: [],
      minSelected: "",
      maxSelected: "",
    },
    rules: [],
    keyLocked: false,
  };
}

export function duplicateQuestion(question: EditorQuestion, questions: EditorQuestion[]) {
  const copy = structuredClone(question);
  copy.id = newId("q");
  copy.key = codeFromLabel(
    `${question.key}_copy`,
    questions.map((q) => q.key),
  );
  copy.label = question.label ? `${question.label} (copy)`.slice(0, 120) : "";
  copy.keyLocked = false;
  copy.answer.options = copy.answer.options.map((o) => ({ ...o, id: newId("o") }));
  copy.rules = copy.rules.map((r) => ({
    ...r,
    id: newId("r"),
    comparisons: r.comparisons.map((c) => ({ ...c, id: newId("c") })),
  }));
  return copy;
}

// Identity questions tell the system which match or team an observation is about.
export interface IdentityPolicy {
  key: IdentityKey;
  policy: "required" | "optional" | "excluded";
  label: string;
  explanation: string;
}

export function identityPolicies(kind: ObservationKind): IdentityPolicy[] {
  const policies = identityContracts[kind];
  const explain = (key: IdentityKey, policy: "required" | "optional" | "excluded") => {
    const subject = key === "match" ? "match" : "team";
    if (policy === "excluded")
      return `${kindLabels[kind]} observations are not about a match, so they cannot ask for one.`;
    if (policy === "required")
      return `Every ${kind} observation must name the ${subject}. This question is always required, is always asked and keeps its answer type.`;
    return `Optional. When you include it, it is always asked, and its answer type is fixed.`;
  };
  return (["match", "team_number"] as const).map((key) => {
    const policy = policies[key] ?? "optional";
    return {
      key,
      policy,
      label: key === "match" ? "Match" : "Team number",
      explanation: explain(key, policy),
    };
  });
}

export function identityPolicy(kind: ObservationKind, key: string) {
  return isIdentityKey(key) ? (identityContracts[kind][key] ?? "optional") : null;
}

// The rule effects a question can still use, in the order the editor lists them.
export function allowedEffects(question: EditorQuestion, kind: ObservationKind): RuleEffect[] {
  const identity = identityPolicy(kind, question.key);
  const effects: RuleEffect[] = [];
  if (!identity) {
    const visibility = question.rules.find((r) => r.effect === "show" || r.effect === "hide");
    if (visibility) effects.push(visibility.effect);
    else effects.push("show", "hide");
  }
  if (question.required) {
    if (identity !== "required") effects.push("optional");
  } else effects.push("require");
  return effects;
}

// Questions this question's rules can depend on: any other question that is not free text.
export const conditionSources = (question: EditorQuestion, questions: EditorQuestion[]) =>
  questions.filter((q) => q.id !== question.id && q.key && q.answer.type !== "text");

export const operatorLabels: Record<ComparisonOperator, string> = {
  equals: "is",
  not_equals: "is not",
  lt: "is less than",
  lte: "is at most",
  gt: "is more than",
  gte: "is at least",
  in: "is one of",
  not_in: "is none of",
  includes: "includes",
  excludes: "does not include",
};

export const operatorsFor = (type: AnswerType) => operatorsByType[type];

// Default operator and value when the admin picks an upstream question.
export function startComparison(upstream: EditorQuestion): Omit<EditorComparison, "id"> {
  const operator = operatorsByType[upstream.answer.type][0] ?? "";
  const first = upstream.answer.options[0]?.code ?? "";
  const value: ComparisonValue =
    upstream.answer.type === "boolean"
      ? true
      : upstream.answer.type === "number"
        ? ""
        : upstream.answer.type === "single_choice" || upstream.answer.type === "multiple_choice"
          ? first
          : null;
  return { question: upstream.key, operator, value };
}

// Keeps the value compatible when the operator changes between one code and a list.
export function changeOperator(
  comparison: EditorComparison,
  operator: ComparisonOperator,
): EditorComparison {
  const many = operator === "in" || operator === "not_in";
  const value = comparison.value;
  if (many && !Array.isArray(value))
    return { ...comparison, operator, value: typeof value === "string" && value ? [value] : [] };
  if (!many && Array.isArray(value)) return { ...comparison, operator, value: value[0] ?? "" };
  return { ...comparison, operator };
}

function valueText(comparison: EditorComparison, upstream: EditorQuestion | undefined) {
  const { value } = comparison;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const option = (code: string) =>
    upstream?.answer.options.find((o) => o.code === code)?.label || code || "…";
  if (Array.isArray(value))
    return value.length ? value.map(option).join(", ") : "… (choose options)";
  if (upstream?.answer.type === "number") return value?.trim() || "…";
  return option(value ?? "");
}

export function comparisonSentence(comparison: EditorComparison, questions: EditorQuestion[]) {
  const upstream = questions.find((q) => q.key === comparison.question);
  const name = upstream
    ? upstream.label || upstream.key
    : comparison.question
      ? `deleted question “${comparison.question}”`
      : "…";
  const operator = comparison.operator ? operatorLabels[comparison.operator] : "…";
  return `${name} ${operator} ${valueText(comparison, upstream)}`;
}

const effectSummary: Record<RuleEffect, string> = {
  show: "Asked only when",
  hide: "Not asked when",
  require: "Required when",
  optional: "Optional when",
};

export function ruleSentence(rule: EditorRule, questions: EditorQuestion[]) {
  if (rule.nested !== undefined)
    return `${effectSummary[rule.effect]} a nested condition (shown as stored)`;
  const parts = rule.comparisons.map((c) => comparisonSentence(c, questions));
  return `${effectSummary[rule.effect]} ${parts.join(rule.match === "all" ? " and " : " or ") || "…"}`;
}

export function answerSummary(question: EditorQuestion) {
  const { answer } = question;
  const range = (min: string, max: string) =>
    min.trim() && max.trim()
      ? ` ${min.trim()} to ${max.trim()}`
      : min.trim()
        ? ` from ${min.trim()}`
        : max.trim()
          ? ` up to ${max.trim()}`
          : "";
  switch (answer.type) {
    case "number":
      return `${answer.format === "integer" ? "Whole number" : "Decimal"}${range(answer.min, answer.max)}`;
    case "text":
      return answer.maxLength.trim() ? `Text up to ${answer.maxLength.trim()} characters` : "Text";
    case "boolean":
      return "Yes or no";
    case "single_choice":
      return `One of ${answer.options.length} options`;
    case "multiple_choice":
      return `Any of ${answer.options.length} options`;
  }
}

// Which questions each question's rules read. Drawn as the outline's rule gutter.
export interface Dependency {
  from: number;
  to: number;
  missing: boolean;
}

export function dependencies(questions: EditorQuestion[]): Dependency[] {
  const index = new Map(questions.map((q, i) => [q.key, i]));
  const edges = new Map<string, Dependency>();
  for (const [to, question] of questions.entries())
    for (const rule of question.rules)
      for (const comparison of rule.comparisons) {
        const from = index.get(comparison.question);
        if (from === undefined || from === to) continue;
        edges.set(`${from}:${to}`, { from, to, missing: false });
      }
  return [...edges.values()];
}

type Parsed = { empty: true } | { invalid: true } | { value: number };
const parseNumber = (value: string): Parsed => {
  const trimmed = value.trim();
  if (!trimmed) return { empty: true };
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? { value: parsed } : { invalid: true };
};

function lengthIssue(value: string, max: number, empty: string, long: string) {
  if (!value.trim()) return empty;
  if (value.trim().length > max) return long;
  return null;
}

// Checks the admin sees while typing. They match what publication enforces, in plain words.
function questionIssues(
  question: EditorQuestion,
  questions: EditorQuestion[],
  kind: ObservationKind,
): EditorIssue[] {
  const issues: EditorIssue[] = [];
  const add = (field: string, message: string) =>
    issues.push({ questionId: question.id, field, message });
  if (!question.key) add("key", "Enter a code.");
  else if (question.key.length > 64) add("key", "Use 64 characters or fewer for the code.");
  else if (!codePattern.test(question.key))
    add("key", "Start the code with a letter and use only lowercase letters, digits and _.");
  else if (questions.some((q) => q.id !== question.id && q.key === question.key))
    add("key", `Another question already uses the code “${question.key}”.`);
  const label = lengthIssue(
    question.label,
    120,
    "Enter a label.",
    "Use 120 characters or fewer for the label.",
  );
  if (label) add("label", label);
  const prompt = lengthIssue(
    question.prompt,
    500,
    "Enter the follow-up question scouts get.",
    "Use 500 characters or fewer for the follow-up question.",
  );
  if (prompt) add("prompt", prompt);
  const guidance = lengthIssue(
    question.guidance,
    2000,
    "Enter extraction guidance.",
    "Use 2,000 characters or fewer for the guidance.",
  );
  if (guidance) add("guidance", guidance);

  const { answer } = question;
  if (answer.type === "number") {
    const min = parseNumber(answer.min);
    const max = parseNumber(answer.max);
    if ("invalid" in min) add("min", "Enter a number for the minimum, or leave it empty.");
    if ("invalid" in max) add("max", "Enter a number for the maximum, or leave it empty.");
    if (answer.format === "integer") {
      if ("value" in min && !Number.isInteger(min.value))
        add("min", "Whole-number questions need a whole-number minimum.");
      if ("value" in max && !Number.isInteger(max.value))
        add("max", "Whole-number questions need a whole-number maximum.");
    }
    if ("value" in min && "value" in max && min.value > max.value)
      add("max", "The maximum must be at least the minimum.");
  }
  if (answer.type === "text") {
    const max = parseNumber(answer.maxLength);
    if (
      "invalid" in max ||
      ("value" in max &&
        (!Number.isInteger(max.value) || max.value < 1 || max.value > LIMITS.textLength))
    )
      add("maxLength", "Enter a whole number from 1 to 20,000, or leave it empty for no limit.");
  }
  if (answer.type === "single_choice" || answer.type === "multiple_choice") {
    const least = answer.type === "single_choice" ? 2 : 1;
    if (answer.options.length < least)
      add("options", least === 2 ? "Add at least two options." : "Add at least one option.");
    if (answer.options.length > LIMITS.options) add("options", "Use 50 options or fewer.");
    const codes = new Map<string, number>();
    const labels = new Map<string, number>();
    for (const option of answer.options) {
      codes.set(option.code, (codes.get(option.code) ?? 0) + 1);
      const lower = option.label.trim().toLowerCase();
      labels.set(lower, (labels.get(lower) ?? 0) + 1);
    }
    for (const option of answer.options) {
      const field = `option:${option.id}`;
      if (!option.label.trim()) add(field, "Enter a label for this option.");
      else if (option.label.trim().length > 120) add(field, "Use 120 characters or fewer.");
      else if ((labels.get(option.label.trim().toLowerCase()) ?? 0) > 1)
        add(field, `Another option is also labelled “${option.label.trim()}”.`);
      if (!option.code) add(field, "Enter a code for this option.");
      else if (!codePattern.test(option.code) || option.code.length > 64)
        add(
          field,
          "Start the option code with a letter and use only lowercase letters, digits and _.",
        );
      else if ((codes.get(option.code) ?? 0) > 1)
        add(field, `Another option already uses the code “${option.code}”.`);
    }
    if (answer.type === "multiple_choice") {
      const min = parseNumber(answer.minSelected);
      const max = parseNumber(answer.maxSelected);
      const count = answer.options.length;
      if (
        "invalid" in min ||
        ("value" in min && (!Number.isInteger(min.value) || min.value < 0 || min.value > count))
      )
        add("minSelected", `Enter a whole number from 0 to ${count}, or leave it empty.`);
      else if (
        "invalid" in max ||
        ("value" in max && (!Number.isInteger(max.value) || max.value < 1 || max.value > count))
      )
        add("maxSelected", `Enter a whole number from 1 to ${count}, or leave it empty.`);
      else if ("value" in min && "value" in max && min.value > max.value)
        add("maxSelected", "The most selections must be at least the fewest.");
    }
  }

  // Rules: everything the rule editor can check without the full contract.
  const effects = new Set(question.rules.map((r) => r.effect));
  if (effects.has("show") && effects.has("hide"))
    add("rules", "Use either “ask only when” or “do not ask when” rules, not both.");
  if (question.rules.length > LIMITS.rulesPerQuestion) add("rules", "Use 10 rules or fewer.");
  const identity = identityPolicy(kind, question.key);
  for (const rule of question.rules) {
    const field = `rule:${rule.id}`;
    if (identity && (rule.effect === "show" || rule.effect === "hide"))
      add(field, "Identity questions are always asked. Remove this rule.");
    else if (identity === "required" && rule.effect === "optional")
      add(field, "This identity question is always required. Remove this rule.");
    else if (rule.effect === "require" && question.required)
      add(
        field,
        "The question is already required, so this rule does nothing. Remove it or make the question optional.",
      );
    else if (rule.effect === "optional" && !question.required)
      add(
        field,
        "The question is already optional, so this rule does nothing. Remove it or make the question required.",
      );
    if (rule.nested !== undefined) continue;
    if (!rule.comparisons.length) add(field, "Add a condition.");
    if (rule.comparisons.length > LIMITS.conditionsPerGroup)
      add(field, "Use 20 conditions or fewer in one rule.");
    for (const comparison of rule.comparisons) {
      const upstream = questions.find((q) => q.key === comparison.question);
      if (!comparison.question) add(field, "Choose the question this rule depends on.");
      else if (comparison.question === question.key)
        add(field, "A question cannot depend on its own answer.");
      else if (!upstream)
        add(
          field,
          `This rule depends on “${comparison.question}”, which is no longer in the specification.`,
        );
      else if (upstream.answer.type === "text")
        add(
          field,
          `“${upstream.label || upstream.key}” is free text, so rules cannot depend on it.`,
        );
      else if (
        !comparison.operator ||
        !operatorsByType[upstream.answer.type].includes(comparison.operator)
      )
        add(field, `Choose a comparison that fits “${upstream.label || upstream.key}”.`);
      else if (upstream.answer.type === "number") {
        const value = parseNumber(typeof comparison.value === "string" ? comparison.value : "");
        if (!("value" in value)) add(field, "Enter the number to compare with.");
      } else if (
        upstream.answer.type === "single_choice" ||
        upstream.answer.type === "multiple_choice"
      ) {
        const values = Array.isArray(comparison.value)
          ? comparison.value
          : typeof comparison.value === "string" && comparison.value
            ? [comparison.value]
            : [];
        if (!values.length) add(field, "Choose an option to compare with.");
        const codes = new Set(upstream.answer.options.map((o) => o.code));
        for (const code of values)
          if (!codes.has(code))
            add(field, `Option “${code}” no longer exists in “${upstream.label || upstream.key}”.`);
      }
    }
  }
  return issues;
}

// Messages for the issues only the full contract validator finds: identity, cycles and the
// rare structural problem the checks above do not cover.
function validatorMessage(issue: ContractIssue, questions: EditorQuestion[]) {
  const name = (key: string | undefined) => {
    const question = questions.find((q) => q.key === key);
    return question?.label || key || "a question";
  };
  switch (issue.code) {
    case "cycle": {
      const loop = issue.message.replace(/^Rules form a cycle: /, "").split(" -> ");
      return `These rules depend on each other in a loop: ${loop.map((k) => name(k)).join(" → ")}. Remove one of them.`;
    }
    case "identity_missing":
      return `Add the ${issue.question === "match" ? "match" : "team number"} identity question. This kind of specification needs it.`;
    case "identity_excluded":
      return `Remove “${issue.question}”. This kind of specification cannot ask for a match.`;
    case "identity_type":
      return issue.question === "match"
        ? "The match identity question must be free text."
        : "The team number identity question must be a whole number with a minimum of 1 or more.";
    case "identity_protected":
      return issue.message.includes("always required")
        ? "This identity question is always required."
        : "Identity questions are always asked. Remove this rule.";
    case "invalid_rule":
      return "This rule is nested too deeply. Simplify it.";
    default:
      return issue.message;
  }
}

const coveredCodes = new Set<ContractIssue["code"]>([
  "duplicate_question",
  "duplicate_option",
  "invalid_constraint",
  "unsupported_comparison",
  "missing_reference",
  "missing_option",
  "self_reference",
  "conflicting_rules",
  "redundant_rule",
]);

function issueField(issue: ContractIssue, question: EditorQuestion | undefined) {
  const [, , field, index, option] = issue.path;
  if (field === "rules" && typeof index === "number" && question?.rules[index])
    return `rule:${question.rules[index].id}`;
  if (field === "answer") {
    if (index === "options" && typeof option === "number" && question?.answer.options[option])
      return `option:${question.answer.options[option].id}`;
    if (index === "min" || index === "max" || index === "maxLength") return index;
    return "answer";
  }
  return typeof field === "string" ? field : "questions";
}

// Places one validator issue on the question, rule or option it is about, so a refused
// publish or test links straight back to the field to fix.
export function editorIssue(issue: ContractIssue, questions: EditorQuestion[]): EditorIssue {
  const index = issue.path[0] === "questions" ? issue.path[1] : undefined;
  const question =
    typeof index === "number" ? questions[index] : questions.find((q) => q.key === issue.question);
  return {
    questionId: question?.id,
    field: question ? issueField(issue, question) : "questions",
    message: validatorMessage(issue, questions),
  };
}

export function contractDocument(
  kind: ObservationKind,
  description: string,
  questions: EditorQuestion[],
) {
  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    kind,
    version: "draft",
    description,
    questions: serializeQuestions(questions),
  };
}

export function editorIssues(
  kind: ObservationKind,
  description: string,
  questions: EditorQuestion[],
): EditorIssue[] {
  const issues: EditorIssue[] = [];
  if (description.length > 2000)
    issues.push({ field: "description", message: "Use 2,000 characters or fewer." });
  if (!questions.length) issues.push({ field: "questions", message: "Add at least one question." });
  if (questions.length > LIMITS.questions)
    issues.push({ field: "questions", message: "Use 100 questions or fewer." });
  for (const question of questions) issues.push(...questionIssues(question, questions, kind));
  const result = validateContract(contractDocument(kind, description, questions), kind);
  if (result.ok) return issues;
  for (const issue of result.issues) {
    if (coveredCodes.has(issue.code)) continue;
    // Structural problems are already described field by field, unless none was found.
    if (issue.code === "invalid_structure" && issues.length) continue;
    issues.push(editorIssue(issue, questions));
  }
  return issues;
}

// The draft as the shared validator sees it. Preview and test run only on a valid contract,
// the same check publication uses.
export function validatedDraft(
  kind: ObservationKind,
  description: string,
  questions: EditorQuestion[],
) {
  return validateContract(contractDocument(kind, description, questions), kind);
}
