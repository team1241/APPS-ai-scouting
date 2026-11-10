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

// The extraction service did not answer usefully. Never carries the sample text.
export class DraftTestFailed extends Error {
  readonly reason: "unavailable" | "timeout" | "invalid";
  constructor(reason: "unavailable" | "timeout" | "invalid") {
    super(`Draft test extraction ${reason}`);
    this.reason = reason;
  }
}

// Draft test (#49): one stateless extraction of synthetic messages against a draft snapshot.
export async function extractDraftTest(
  baseUrl: string,
  contract: Contract,
  messages: ExtractionMessage[],
  serviceToken?: string,
): Promise<ModelExtraction> {
  let response: Response;
  try {
    response = await fetch(new URL("/scouting/draft-test", baseUrl), {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
      },
      body: JSON.stringify({ contract, messages }),
      signal: AbortSignal.timeout(DRAFT_TEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DraftTestFailed(
      error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unavailable",
    );
  }
  if (!response.ok) throw new DraftTestFailed(response.status === 400 ? "invalid" : "unavailable");
  const result = modelExtractionSchema.safeParse(await response.json().catch(() => null));
  if (
    !result.success ||
    result.data.specificationVersion !== contract.version ||
    result.data.turns.length !== messages.length
  )
    throw new DraftTestFailed("invalid");
  return result.data;
}

export const DRAFT_TEST_TIMEOUT_MS = 45_000;
