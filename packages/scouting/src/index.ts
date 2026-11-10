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

export * from "./contract.ts";
export * from "./draft-test.ts";
export * from "./extraction.ts";
export * from "./rules.ts";
