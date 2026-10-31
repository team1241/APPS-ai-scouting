import { extractionResultSchema, finalizeExtraction } from "@ai-scouting/scouting";

export async function extractNote(baseUrl: string, text: string, serviceToken?: string) {
  const response = await fetch(new URL("/api/workflows/scouting-extraction/start-async", baseUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
    },
    body: JSON.stringify({ inputData: { text } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw Error(`Mastra request failed (HTTP ${response.status})`);
  const execution = (await response.json()) as { status?: string; result?: unknown };
  if (execution.status !== "success") throw Error("Extraction workflow did not succeed");
  return finalizeExtraction(extractionResultSchema.parse(execution.result).values);
}
