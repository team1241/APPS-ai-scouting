import { extractSessionTurn } from "./mastra-client.ts";
import { claimExtraction, failExtraction, finishExtraction } from "./repositories/extraction.ts";
import { startWorkerLoop } from "./worker-loop.ts";

export async function runExtractionPass(
  organizationId: string,
  baseUrl: string,
  serviceToken?: string,
) {
  const entry = await claimExtraction(organizationId);
  if (!entry) return false;
  try {
    const extracted = await extractSessionTurn(
      baseUrl,
      entry.id,
      entry.turnId,
      entry.text,
      serviceToken,
      entry.specification,
    );
    const saved = await finishExtraction(organizationId, entry.id, entry.lease, extracted, null);
    if (saved.numUpdatedRows !== 1n) throw Error("Extraction lease expired before save");
  } catch {
    await failExtraction(organizationId, entry.id, entry.lease);
    console.error("Extraction attempt failed; inspect queue state");
  }
  return true;
}

export function startExtractionWorker(
  organizationId: string,
  baseUrl: string,
  _botToken: string,
  serviceToken?: string,
  active: () => boolean = () => true,
) {
  return startWorkerLoop(() => runExtractionPass(organizationId, baseUrl, serviceToken), active);
}
