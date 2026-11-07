import { extractSessionTurn } from "./mastra-client.ts";
import { claimExtraction, failExtraction, finishExtraction } from "./repositories/extraction.ts";

export function startExtractionWorker(
  organizationId: string,
  baseUrl: string,
  _botToken: string,
  serviceToken?: string,
) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    let entry: Awaited<ReturnType<typeof claimExtraction>> = null;
    try {
      entry = await claimExtraction(organizationId);
      if (!entry) return;
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
      console.error("Extraction failed; entry will retry (maximum three attempts)");
      if (entry)
        await failExtraction(organizationId, entry.id, entry.lease).catch(() =>
          console.error("Could not record extraction failure"),
        );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5000);
  void tick();
  return () => clearInterval(timer);
}
