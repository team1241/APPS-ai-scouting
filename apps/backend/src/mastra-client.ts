import {
  extractionResultSchema,
  finalizeExtraction,
  requirements,
  type Specification,
} from "@ai-scouting/scouting";

export async function extractSessionTurn(
  baseUrl: string,
  sessionId: string,
  turnId: string,
  text: string,
  serviceToken?: string,
  specification: Specification = requirements,
) {
  const response = await fetch(new URL(`/scouting/sessions/${sessionId}/turn`, baseUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
    },
    body: JSON.stringify({ turnId, text, specification, deferFinalization: true }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw Error(`Mastra session request failed (HTTP ${response.status})`);
  const result = extractionResultSchema.parse(await response.json());
  if (result.specificationVersion !== specification.version) throw Error("Specification mismatch");
  return finalizeExtraction(result.values, specification);
}
