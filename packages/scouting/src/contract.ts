import { z } from "zod";

// Contract format version. This is the shape of the document, not the identity of a publication.
// A publication is identified by organization, season, kind and `version`.
export const CONTRACT_FORMAT_VERSION = 2;

export const observationKinds = ["match", "pit", "general"] as const;
export type ObservationKind = (typeof observationKinds)[number];

export const answerTypes = [
  "number",
  "text",
  "boolean",
  "single_choice",
  "multiple_choice",
] as const;
export type AnswerType = (typeof answerTypes)[number];

export const comparisonOperators = [
  "equals",
  "not_equals",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "not_in",
  "includes",
  "excludes",
] as const;
export type ComparisonOperator = (typeof comparisonOperators)[number];

// Operators each upstream answer type supports. Free text is not a condition source.
export const operatorsByType: Record<AnswerType, readonly ComparisonOperator[]> = {
  boolean: ["equals", "not_equals"],
  number: ["equals", "not_equals", "lt", "lte", "gt", "gte"],
  single_choice: ["equals", "not_equals", "in", "not_in"],
  multiple_choice: ["includes", "excludes"],
  text: [],
};

export const ruleEffects = ["show", "hide", "require", "optional"] as const;
export type RuleEffect = (typeof ruleEffects)[number];

export const LIMITS = {
  questions: 100,
  options: 50,
  rulesPerQuestion: 10,
  conditionsPerGroup: 20,
  conditionDepth: 4,
  textLength: 20000,
} as const;

const code = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, digits and underscores");
const wording = (max: number) => z.string().trim().min(1).max(max);

const optionSchema = z.object({ code, label: wording(120) }).strict();

const numberAnswerSchema = z
  .object({
    type: z.literal("number"),
    format: z.enum(["integer", "decimal"]),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict();
const textAnswerSchema = z
  .object({
    type: z.literal("text"),
    maxLength: z.number().int().min(1).max(LIMITS.textLength).optional(),
  })
  .strict();
const booleanAnswerSchema = z.object({ type: z.literal("boolean") }).strict();
const singleChoiceAnswerSchema = z
  .object({
    type: z.literal("single_choice"),
    options: z.array(optionSchema).min(2).max(LIMITS.options),
  })
  .strict();
const multipleChoiceAnswerSchema = z
  .object({
    type: z.literal("multiple_choice"),
    options: z.array(optionSchema).min(1).max(LIMITS.options),
    minSelected: z.number().int().min(0).optional(),
    maxSelected: z.number().int().min(1).optional(),
  })
  .strict();

export const answerSchema = z.discriminatedUnion("type", [
  numberAnswerSchema,
  textAnswerSchema,
  booleanAnswerSchema,
  singleChoiceAnswerSchema,
  multipleChoiceAnswerSchema,
]);
export type Answer = z.infer<typeof answerSchema>;
export type ChoiceAnswer = Extract<Answer, { type: "single_choice" | "multiple_choice" }>;

export type ConditionValue = boolean | number | string | string[];
export interface Comparison {
  question: string;
  operator: ComparisonOperator;
  value: ConditionValue;
}
export type Condition = Comparison | { all: Condition[] } | { any: Condition[] };

const comparisonSchema = z
  .object({
    question: code,
    operator: z.enum(comparisonOperators),
    value: z.union([z.boolean(), z.number(), code, z.array(code).min(1).max(LIMITS.options)]),
  })
  .strict();
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1).max(LIMITS.conditionsPerGroup) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1).max(LIMITS.conditionsPerGroup) }).strict(),
    comparisonSchema,
  ]),
);

export const ruleSchema = z.object({ effect: z.enum(ruleEffects), when: conditionSchema }).strict();
export type Rule = z.infer<typeof ruleSchema>;

export const questionSchema = z
  .object({
    // Stable code. Stored answers, rules and data consumers use it; it never changes meaning.
    key: code,
    // Human-facing wording, editable without changing stored data.
    label: wording(120),
    prompt: wording(500),
    // Model-facing extraction guidance. Never shown to scouts.
    guidance: wording(2000),
    required: z.boolean(),
    answer: answerSchema,
    rules: z.array(ruleSchema).max(LIMITS.rulesPerQuestion).optional(),
  })
  .strict();
export type Question = z.infer<typeof questionSchema>;

export const contractSchema = z
  .object({
    formatVersion: z.literal(CONTRACT_FORMAT_VERSION),
    kind: z.enum(observationKinds),
    version: z.string().trim().min(1).max(80),
    description: z.string().max(2000),
    questions: z.array(questionSchema).min(1).max(LIMITS.questions),
  })
  .strict();
export type Contract = z.infer<typeof contractSchema>;

// Format 1: the original starter document. Kept so immutable publications stay readable.
export const legacySpecificationSchema = z.object({
  version: z.string().min(1),
  description: z.string(),
  fields: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]*$/),
        type: z.enum(["text", "integer", "boolean"]),
        required: z.boolean(),
        description: z.string().min(1),
        question: z.string().min(1),
      }),
    )
    .min(1),
});
export type LegacySpecification = z.infer<typeof legacySpecificationSchema>;

// Protected identity by kind. Event context always comes from the session's event binding.
// Identity questions keep their system type, are never hidden and, where required, never optional.
export const identityQuestions = {
  match: { kind: "text" },
  team_number: { kind: "team" },
} as const;
export type IdentityKey = keyof typeof identityQuestions;
export const identityContracts: Record<
  ObservationKind,
  Partial<Record<IdentityKey, "required" | "optional" | "excluded">>
> = {
  match: { match: "required", team_number: "required" },
  pit: { match: "excluded", team_number: "required" },
  general: { match: "optional", team_number: "optional" },
};
export const isIdentityKey = (key: string): key is IdentityKey =>
  Object.hasOwn(identityQuestions, key);

export type ContractIssueCode =
  | "invalid_structure"
  | "unsupported_format"
  | "unsupported_type"
  | "kind_mismatch"
  | "duplicate_question"
  | "duplicate_option"
  | "invalid_constraint"
  | "invalid_rule"
  | "unsupported_comparison"
  | "missing_reference"
  | "missing_option"
  | "self_reference"
  | "cycle"
  | "conflicting_rules"
  | "redundant_rule"
  | "identity_missing"
  | "identity_excluded"
  | "identity_type"
  | "identity_protected";

export interface ContractIssue {
  code: ContractIssueCode;
  path: (string | number)[];
  question?: string;
  message: string;
}

export type ContractValidation =
  | { ok: true; contract: Contract }
  | { ok: false; issues: ContractIssue[] };

export class ContractError extends Error {
  readonly issues: ContractIssue[];
  constructor(issues: ContractIssue[]) {
    super(`Invalid scouting contract: ${issues.map((i) => i.message).join("; ")}`);
    this.issues = issues;
  }
}

const record = (input: unknown): Record<string, unknown> | null =>
  input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;

export function* comparisons(
  condition: Condition,
  path: (string | number)[],
  depth = 1,
): Generator<{
  comparison: Comparison;
  path: (string | number)[];
  depth: number;
}> {
  if ("all" in condition)
    for (const [i, c] of condition.all.entries())
      yield* comparisons(c, [...path, "all", i], depth + 1);
  else if ("any" in condition)
    for (const [i, c] of condition.any.entries())
      yield* comparisons(c, [...path, "any", i], depth + 1);
  else yield { comparison: condition, path, depth };
}

function conditionIssues(
  question: Question,
  comparison: Comparison,
  path: (string | number)[],
  byKey: Map<string, Question>,
): ContractIssue[] {
  const at = { path, question: question.key };
  if (comparison.question === question.key)
    return [{ ...at, code: "self_reference", message: `${question.key} cannot depend on itself` }];
  const upstream = byKey.get(comparison.question);
  if (!upstream)
    return [
      {
        ...at,
        code: "missing_reference",
        message: `${question.key} depends on unknown question ${comparison.question}`,
      },
    ];
  const { answer } = upstream;
  const { operator, value } = comparison;
  if (!operatorsByType[answer.type].includes(operator))
    return [
      {
        ...at,
        code: "unsupported_comparison",
        message: `${operator} is not supported for ${answer.type} question ${upstream.key}`,
      },
    ];
  const unsupported = (expected: string): ContractIssue[] => [
    {
      ...at,
      code: "unsupported_comparison",
      message: `${operator} on ${upstream.key} needs ${expected}`,
    },
  ];
  if (answer.type === "boolean")
    return typeof value === "boolean" ? [] : unsupported("true or false");
  if (answer.type === "number") return typeof value === "number" ? [] : unsupported("a number");
  if (answer.type === "single_choice" || answer.type === "multiple_choice") {
    const many = operator === "in" || operator === "not_in";
    if (many ? !Array.isArray(value) : typeof value !== "string")
      return unsupported(many ? "a list of option codes" : "one option code");
    const codes = new Set(answer.options.map((o) => o.code));
    return (Array.isArray(value) ? value : [value as string])
      .filter((v) => !codes.has(v))
      .map((v) => ({
        ...at,
        code: "missing_option" as const,
        message: `${question.key} refers to missing option ${v} of ${upstream.key}`,
      }));
  }
  return unsupported("a supported answer type");
}

function answerIssues(question: Question, path: (string | number)[]): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const at = { question: question.key };
  const { answer } = question;
  if (answer.type === "number") {
    for (const bound of ["min", "max"] as const) {
      const value = answer[bound];
      if (answer.format === "integer" && value !== undefined && !Number.isInteger(value))
        issues.push({
          ...at,
          path: [...path, "answer", bound],
          code: "invalid_constraint",
          message: `${question.key} integer ${bound} must be a whole number`,
        });
    }
    if (answer.min !== undefined && answer.max !== undefined && answer.min > answer.max)
      issues.push({
        ...at,
        path: [...path, "answer"],
        code: "invalid_constraint",
        message: `${question.key} min is greater than max`,
      });
  }
  if (answer.type === "single_choice" || answer.type === "multiple_choice") {
    const codes = new Set<string>();
    const labels = new Set<string>();
    for (const [i, option] of answer.options.entries()) {
      const label = option.label.toLowerCase();
      if (codes.has(option.code) || labels.has(label))
        issues.push({
          ...at,
          path: [...path, "answer", "options", i],
          code: "duplicate_option",
          message: `${question.key} repeats option ${codes.has(option.code) ? option.code : option.label}`,
        });
      codes.add(option.code);
      labels.add(label);
    }
  }
  if (answer.type === "multiple_choice") {
    const min = answer.minSelected ?? 0;
    const max = answer.maxSelected ?? answer.options.length;
    if (min > max || max > answer.options.length)
      issues.push({
        ...at,
        path: [...path, "answer"],
        code: "invalid_constraint",
        message: `${question.key} selection limits must fit 0 to ${answer.options.length} options`,
      });
  }
  return issues;
}

function identityIssues(contract: Contract): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const expected = identityContracts[contract.kind];
  for (const key of Object.keys(identityQuestions) as IdentityKey[]) {
    const index = contract.questions.findIndex((q) => q.key === key);
    const question = contract.questions[index];
    const policy = expected[key] ?? "optional";
    const path = ["questions", index];
    if (!question) {
      if (policy === "required")
        issues.push({
          code: "identity_missing",
          path: ["questions"],
          question: key,
          message: `${contract.kind} contracts require the ${key} identity question`,
        });
      continue;
    }
    if (policy === "excluded") {
      issues.push({
        code: "identity_excluded",
        path,
        question: key,
        message: `${contract.kind} contracts cannot ask for ${key}`,
      });
      continue;
    }
    if (policy === "required" && !question.required)
      issues.push({
        code: "identity_protected",
        path: [...path, "required"],
        question: key,
        message: `${key} identity is always required for ${contract.kind}`,
      });
    // Identity can never be hidden, and required identity can never become optional.
    for (const [i, rule] of (question.rules ?? []).entries())
      if (
        rule.effect === "show" ||
        rule.effect === "hide" ||
        (policy === "required" && rule.effect === "optional")
      )
        issues.push({
          code: "identity_protected",
          path: [...path, "rules", i, "effect"],
          question: key,
          message: `${key} identity cannot have a ${rule.effect} rule`,
        });
    const { answer } = question;
    const valid =
      identityQuestions[key].kind === "text"
        ? answer.type === "text"
        : answer.type === "number" &&
          answer.format === "integer" &&
          answer.min !== undefined &&
          answer.min >= 1;
    if (!valid)
      issues.push({
        code: "identity_type",
        path: [...path, "answer"],
        question: key,
        message:
          key === "match"
            ? "match identity must be free text"
            : "team_number identity must be an integer with min 1 or more",
      });
  }
  return issues;
}

function cycleIssues(contract: Contract): ContractIssue[] {
  const edges = new Map(
    contract.questions.map((q) => [
      q.key,
      [
        ...new Set(
          (q.rules ?? []).flatMap((r) =>
            [...comparisons(r.when, [])].map((c) => c.comparison.question),
          ),
        ),
      ],
    ]),
  );
  const issues: ContractIssue[] = [];
  const state = new Map<string, "visiting" | "done">();
  const reported = new Set<string>();
  const visit = (key: string, trail: string[]) => {
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") {
      const cycle = [...trail.slice(trail.indexOf(key)), key];
      const id = [...cycle.slice(0, -1)].sort().join(",");
      if (!reported.has(id)) {
        reported.add(id);
        issues.push({
          code: "cycle",
          path: ["questions", contract.questions.findIndex((q) => q.key === key), "rules"],
          question: key,
          message: `Rules form a cycle: ${cycle.join(" -> ")}`,
        });
      }
      return;
    }
    state.set(key, "visiting");
    for (const next of edges.get(key) ?? [])
      if (edges.has(next) && next !== key) visit(next, [...trail, key]);
    state.set(key, "done");
  };
  for (const q of contract.questions) visit(q.key, []);
  return issues;
}

function ruleIssues(contract: Contract): ContractIssue[] {
  const byKey = new Map(contract.questions.map((q) => [q.key, q]));
  const issues: ContractIssue[] = [];
  for (const [index, question] of contract.questions.entries()) {
    const rules = question.rules ?? [];
    const effects = new Set(rules.map((r) => r.effect));
    const path = ["questions", index, "rules"];
    if (effects.has("show") && effects.has("hide"))
      issues.push({
        code: "conflicting_rules",
        path,
        question: question.key,
        message: `${question.key} mixes show and hide rules; use one visibility effect`,
      });
    for (const [i, rule] of rules.entries()) {
      const rulePath = [...path, i];
      if (
        (rule.effect === "require" && question.required) ||
        (rule.effect === "optional" && !question.required)
      )
        issues.push({
          code: "redundant_rule",
          path: [...rulePath, "effect"],
          question: question.key,
          message: `${question.key} is already ${question.required ? "required" : "optional"}; ${rule.effect} has no effect`,
        });
      for (const { comparison, path: leafPath, depth } of comparisons(rule.when, [
        ...rulePath,
        "when",
      ])) {
        if (depth > LIMITS.conditionDepth)
          issues.push({
            code: "invalid_rule",
            path: leafPath,
            question: question.key,
            message: `${question.key} rule nests deeper than ${LIMITS.conditionDepth} levels`,
          });
        issues.push(...conditionIssues(question, comparison, leafPath, byKey));
      }
    }
  }
  return issues;
}

// Structural and semantic validation. Every issue has a path to the question, option or rule.
export function validateContract(
  input: unknown,
  expectedKind?: ObservationKind,
): ContractValidation {
  const raw = record(input);
  if (raw && raw.formatVersion !== undefined && raw.formatVersion !== CONTRACT_FORMAT_VERSION)
    return {
      ok: false,
      issues: [
        {
          code: "unsupported_format",
          path: ["formatVersion"],
          message: `Unsupported contract format ${String(raw.formatVersion)}`,
        },
      ],
    };
  // Report unknown answer types explicitly so readers fail closed instead of dropping questions.
  const unsupported: ContractIssue[] = [];
  if (raw && Array.isArray(raw.questions))
    for (const [i, q] of raw.questions.entries()) {
      const type = record(record(q)?.answer)?.type;
      if (typeof type === "string" && !(answerTypes as readonly string[]).includes(type))
        unsupported.push({
          code: "unsupported_type",
          path: ["questions", i, "answer", "type"],
          question: typeof record(q)?.key === "string" ? (record(q)?.key as string) : undefined,
          message: `Unsupported answer type ${type}`,
        });
    }
  if (unsupported.length) return { ok: false, issues: unsupported };
  const parsed = contractSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "invalid_structure",
        path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: `${issue.path.join(".") || "contract"}: ${issue.message}`,
      })),
    };
  const contract = parsed.data;
  const issues: ContractIssue[] = [];
  if (expectedKind && contract.kind !== expectedKind)
    issues.push({
      code: "kind_mismatch",
      path: ["kind"],
      message: `Contract kind ${contract.kind} does not match ${expectedKind}`,
    });
  const seen = new Set<string>();
  for (const [i, q] of contract.questions.entries()) {
    if (seen.has(q.key))
      issues.push({
        code: "duplicate_question",
        path: ["questions", i, "key"],
        question: q.key,
        message: `Question code ${q.key} is used more than once`,
      });
    seen.add(q.key);
    issues.push(...answerIssues(q, ["questions", i]));
  }
  issues.push(...identityIssues(contract));
  // Reference checks need unique codes to be meaningful.
  if (!issues.some((i) => i.code === "duplicate_question")) {
    const ruleProblems = ruleIssues(contract);
    issues.push(...ruleProblems);
    if (!ruleProblems.some((i) => i.code === "missing_reference" || i.code === "self_reference"))
      issues.push(...cycleIssues(contract));
  }
  return issues.length ? { ok: false, issues } : { ok: true, contract };
}

const labelFromKey = (key: string) => {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Read a format 1 starter document with its original semantics: text stays unbounded text,
// integer stays a positive integer, and nothing is conditional.
export function upgradeLegacySpecification(
  specification: LegacySpecification,
  kind: ObservationKind = "match",
): Contract {
  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    kind,
    version: specification.version,
    description: specification.description,
    questions: specification.fields.map((field) => ({
      key: field.key,
      label: labelFromKey(field.key),
      prompt: field.question,
      guidance: field.description,
      required: field.required,
      answer:
        field.type === "integer"
          ? { type: "number", format: "integer", min: 1 }
          : field.type === "boolean"
            ? { type: "boolean" }
            : { type: "text" },
    })),
  };
}

export const contractFormat = (document: unknown): number | null => {
  const raw = record(document);
  if (!raw) return null;
  if (raw.formatVersion === undefined) return Array.isArray(raw.fields) ? 1 : null;
  return typeof raw.formatVersion === "number" ? raw.formatVersion : null;
};

// Read any stored publication. Unknown formats and invalid documents fail closed.
export function readContract(document: unknown, kind?: ObservationKind): Contract {
  const format = contractFormat(document);
  if (format === 1) {
    const contract = upgradeLegacySpecification(legacySpecificationSchema.parse(document), kind);
    const result = validateContract(contract, kind);
    if (!result.ok) throw new ContractError(result.issues);
    return result.contract;
  }
  const result = validateContract(document, kind);
  if (!result.ok) throw new ContractError(result.issues);
  return result.contract;
}
