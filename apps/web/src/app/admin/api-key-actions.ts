"use server";

import { revalidatePath } from "next/cache";
import { backendRequest } from "@/lib/backend";

export interface ApiKeyFormState {
  status: "idle" | "error" | "done";
  message?: string;
  name: string;
  // The new key, so the list can show it right away.
  createdId?: string;
}

export interface RevokeKeyState {
  error?: string;
}

const keysPath = (org: string) => `/web/organizations/${encodeURIComponent(org)}/api-keys`;

async function errorMessage(response: Response | null, fallback: string) {
  if (!response || response.status >= 500) return fallback;
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function createApiKey(
  _previous: ApiKeyFormState,
  form: FormData,
): Promise<ApiKeyFormState> {
  const org = String(form.get("organizationId"));
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { status: "error", message: "Enter a name for the key.", name };
  const response = await backendRequest(keysPath(org), {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (response?.status !== 201)
    return {
      status: "error",
      message: await errorMessage(response, "The key could not be created. Try again shortly."),
      name,
    };
  const { key } = (await response.json()) as { key: { id: string } };
  revalidatePath(`/admin/${org}`);
  return { status: "done", name: "", createdId: key.id };
}

export async function revokeApiKey(
  _previous: RevokeKeyState,
  form: FormData,
): Promise<RevokeKeyState> {
  const org = String(form.get("organizationId"));
  const id = String(form.get("keyId"));
  const response = await backendRequest(`${keysPath(org)}/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
  });
  // An already revoked key is the outcome the admin asked for.
  if (!response?.ok && response?.status !== 404)
    return {
      error: await errorMessage(response, "The key could not be revoked. Try again shortly."),
    };
  revalidatePath(`/admin/${org}`);
  return {};
}
