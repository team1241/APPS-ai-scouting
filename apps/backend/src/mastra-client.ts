import { extractionResultSchema, finalizeExtraction } from "@ai-scouting/scouting";

export async function extractSessionTurn(
  baseUrl: string,
  sessionId: string,
  turnId: string,
  text: string,
  serviceToken?: string,
) {
  const response = await fetch(new URL(`/scouting/sessions/${sessionId}/turn`, baseUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
    },
    body: JSON.stringify({ turnId, text, deferFinalization: true }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw Error(`Mastra session request failed (HTTP ${response.status})`);
  const result = extractionResultSchema.parse(await response.json());
  return finalizeExtraction(result.values);
}
