import { type ModelExtraction, requirements } from "@ai-scouting/scouting";

// Test helper: a model extraction where one message states every given value.
export const stated = (
  values: Record<string, unknown>,
  version: string = requirements.version,
  ...more: Record<string, unknown>[]
): ModelExtraction => ({ specificationVersion: version, turns: [values, ...more] });
