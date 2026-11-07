import { extractionReply } from "./extraction-reply.ts";
import { extractSessionTurn } from "./mastra-client.ts";
import {
  claimExtraction,
  failExtraction,
  finishExtraction,
  recordExtractionQuestion,
} from "./repositories/extraction.ts";

export function startExtractionWorker(
  organizationId: string,
  baseUrl: string,
  botToken: string,
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
      const result = saved.result;
      const reply = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          chat_id: entry.chatId,
          text:
            result.question && result.question !== extracted.question
              ? result.question
              : `${extractionReply(result)}${saved.notice ? `\nSchedule validation: ${saved.notice}` : ""}`,
          ...(result.question ? { reply_markup: { force_reply: true, selective: true } } : {}),
        }),
      });
      const sent = (await reply.json()) as { ok?: boolean; result?: { message_id: number } };
      if (!reply.ok || !sent.ok || !sent.result) throw Error("Telegram follow-up failed");
      if (result.question)
        await recordExtractionQuestion(
          organizationId,
          entry.id,
          entry.lease,
          String(sent.result.message_id),
        );
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
