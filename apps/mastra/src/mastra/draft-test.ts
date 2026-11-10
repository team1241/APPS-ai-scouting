import {
  type Contract,
  draftTestMessagesSchema,
  type ExtractionMessage,
  validateContract,
} from "@ai-scouting/scouting";
import { z } from "zod";

type Extract = (request: {
  contract: Contract;
  messages: ExtractionMessage[];
}) => Promise<{ turns: Record<string, unknown>[] }>;

const requestSchema = z
  .object({ contract: z.unknown(), messages: draftTestMessagesSchema })
  .strict();

// Draft test (#49): one stateless extraction. No workflow run, no storage, no Telegram.
// The contract must pass the same validation as a publication before the model sees it.
export async function runDraftTest(
  extract: Extract,
  body: unknown,
): Promise<{ status: 200 | 400 | 503; body: unknown }> {
  const request = requestSchema.safeParse(body);
  if (!request.success) return { status: 400, body: { error: "Invalid draft test" } };
  const validation = validateContract(request.data.contract);
  if (!validation.ok) return { status: 400, body: { error: "Invalid scouting contract" } };
  const { contract } = validation;
  try {
    const { turns } = await extract({ contract, messages: request.data.messages });
    if (turns.length !== request.data.messages.length) throw Error("Turn count mismatch");
    return { status: 200, body: { specificationVersion: contract.version, turns } };
  } catch {
    // Never echo provider errors: they can quote the sample text.
    return { status: 503, body: { error: "Extraction model unavailable" } };
  }
}
