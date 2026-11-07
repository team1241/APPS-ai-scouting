import { claimDelivery, type DeliveryOutcome, settleDelivery } from "./repositories/outbound.ts";

export async function sendTelegram(
  token: string,
  recipient: string,
  text: string,
  question: boolean,
  fetcher = fetch,
): Promise<DeliveryOutcome> {
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: recipient,
        text,
        ...(question ? { reply_markup: { force_reply: true, selective: true } } : {}),
      }),
    });
    const body = (await response.json()) as {
      ok?: boolean;
      result?: { message_id?: number };
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    if (response.ok && body.ok && Number.isSafeInteger(body.result?.message_id))
      return { status: "sent", messageId: String(body.result?.message_id) };
    if (body.ok === false) {
      const code = Number.isSafeInteger(body.error_code)
        ? (body.error_code as number)
        : response.status;
      return {
        status: code === 429 || code >= 500 ? "pending" : "failed",
        error: `Telegram rejection ${code}`,
        ...(code === 429
          ? {
              retryMs:
                Math.max(
                  1,
                  Number.isFinite(body.parameters?.retry_after)
                    ? (body.parameters?.retry_after as number)
                    : 60,
                ) * 1000,
            }
          : {}),
      };
    }
  } catch {
    /* Transport errors may follow server acceptance. Never automatically resend. */
  }
  return { status: "ambiguous", error: "Telegram acceptance unknown" };
}
export async function drainOutbound(org: string, token: string, fetcher = fetch, now?: Date) {
  let sent = 0;
  for (let i = 0; i < 100; i++) {
    const row = await claimDelivery(org, now ?? new Date());
    if (!row) break;
    if (row.cancelled) continue;
    const outcome = await sendTelegram(
      token,
      row.recipient,
      row.question ? `${row.text}\nSession reference: ${row.id}` : row.text,
      row.question,
      fetcher,
    );
    // If this commit fails, leave sending for lease recovery as ambiguous.
    await settleDelivery(org, row.id, row.lease_token, outcome, now ?? new Date());
    if (outcome.status === "sent") sent++;
    if (outcome.status === "pending" && outcome.retryMs) break;
  }
  return sent;
}
export function startOutboundWorker(org: string, token: string) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await drainOutbound(org, token);
    } catch {
      console.error("Outbound pass failed; durable state retained");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5000);
  void tick();
  return () => clearInterval(timer);
}
