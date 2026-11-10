import { z } from "zod";
import document from "./requirements.json" with { type: "json" };

const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  type: z.enum(["text", "integer", "boolean"]),
  required: z.boolean(),
  description: z.string().min(1),
  question: z.string().min(1),
});
export const specificationSchema = z.object({
  version: z.string().min(1),
  description: z.string(),
  fields: z.array(fieldSchema).min(1),
});
export type Specification = z.infer<typeof specificationSchema>;
export const requirements = specificationSchema.parse(document);
if (new Set(requirements.fields.map((f) => f.key)).size !== requirements.fields.length)
  throw Error("Duplicate requirement keys");
export const valueSchema = z.union([
  z.string(),
  z.number().int().positive(),
  z.boolean(),
  z.null(),
]);
export const extractionInputSchema = z.object({ text: z.string().min(1).max(20000) });
export const extractionResultSchema = z.object({
  specificationVersion: z.string().min(1),
  values: z.record(z.string(), valueSchema),
  missing: z.array(z.string()),
  question: z.string().nullable(),
  status: z.enum(["complete", "needs_review"]),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export function extractionShape(specification: Specification = requirements) {
  return z.object(
    Object.fromEntries(
      specification.fields.map((field) => {
        const type =
          field.type === "boolean"
            ? z.boolean()
            : field.type === "integer"
              ? z.number().int().positive()
              : z.string().trim().min(1);
        return [
          field.key,
          type
            .nullable()
            .describe(`${field.description} Return null if missing, ambiguous or conflicting.`),
        ];
      }),
    ),
  );
}
export function finalizeExtraction(
  input: unknown,
  specification: Specification = requirements,
): ExtractionResult {
  const values = extractionShape(specification).parse(input);
  const missing = specification.fields
    .filter((f) => f.required && values[f.key] === null)
    .map((f) => f.key);
  const questions = specification.fields
    .filter((f) => missing.includes(f.key))
    .map((f) => f.question);
  return {
    specificationVersion: specification.version,
    values,
    missing,
    question: questions.length ? questions.join(" ") : null,
    status: missing.length ? "needs_review" : "complete",
  };
}

export * from "./contract.ts";
export * from "./rules.ts";
