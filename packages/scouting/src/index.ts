import { z } from "zod";
import document from "./requirements.json" with { type: "json" };

const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  type: z.enum(["text", "integer", "boolean"]),
  required: z.boolean(),
  description: z.string().min(1),
  question: z.string().min(1),
});
export const requirements = z
  .object({
    version: z.string().min(1),
    description: z.string(),
    fields: z.array(fieldSchema).min(1),
  })
  .parse(document);
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
  specificationVersion: z.literal(requirements.version),
  values: z.record(z.string(), valueSchema),
  missing: z.array(z.string()),
  question: z.string().nullable(),
  status: z.enum(["complete", "needs_review"]),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export function extractionShape() {
  return z.object(
    Object.fromEntries(
      requirements.fields.map((field) => {
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
export function finalizeExtraction(input: unknown): ExtractionResult {
  const values = extractionShape().parse(input);
  const missing = requirements.fields
    .filter((f) => f.required && values[f.key] === null)
    .map((f) => f.key);
  const questions = requirements.fields
    .filter((f) => missing.includes(f.key))
    .map((f) => f.question);
  return {
    specificationVersion: requirements.version,
    values,
    missing,
    question: questions.length ? questions.join(" ") : null,
    status: missing.length ? "needs_review" : "complete",
  };
}
