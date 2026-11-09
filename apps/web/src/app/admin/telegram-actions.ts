"use server";

import { revalidatePath } from "next/cache";
import { backendRequest } from "@/lib/backend";

export interface TelegramActionState {
  error?: string;
  url?: string;
  expiresAt?: string;
}

const statePath = (org: string) => `/web/organizations/${encodeURIComponent(org)}/telegram`;

export async function telegramAction(
  _previous: TelegramActionState,
  form: FormData,
): Promise<TelegramActionState> {
  const org = String(form.get("organizationId"));
  const action = form.get("action") === "disconnect" ? "disconnect" : "connect";
  const response = await backendRequest(`${statePath(org)}/${action}`, { method: "POST" });
  if (!response?.ok) return { error: "Telegram could not be updated. Try again shortly." };
  revalidatePath(`/admin/${org}`);
  return action === "connect" ? await response.json() : {};
}

// Polled while a connection link is open, so the page updates without a manual refresh.
export async function telegramConnected(org: string): Promise<boolean> {
  const response = await backendRequest(`${statePath(org)}/state`);
  if (!response?.ok) return false;
  return ((await response.json()) as { connected: boolean }).connected;
}
