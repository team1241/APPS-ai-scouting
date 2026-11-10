import {
  type Contract,
  type ExtractionMessage,
  type ModelExtraction,
  modelExtractionSchema,
} from "@ai-scouting/scouting";

// Sends the pinned contract and the scout's messages. The response holds only what each
// message states; the backend validates values and decides completeness.
export async function extractSessionTurn(
  baseUrl: string,
  sessionId: string,
  turnId: string,
  contract: Contract,
  messages: ExtractionMessage[],
  serviceToken?: string,
): Promise<ModelExtraction> {
  const response = await fetch(new URL(`/scouting/sessions/${sessionId}/turn`, baseUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
    },
    body: JSON.stringify({ turnId, contract, messages }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw Error(`Mastra session request failed (HTTP ${response.status})`);
  const result = modelExtractionSchema.parse(await response.json());
  if (result.specificationVersion !== contract.version) throw Error("Specification mismatch");
  if (result.turns.length !== messages.length) throw Error("Extraction turn count mismatch");
  return result;
}
