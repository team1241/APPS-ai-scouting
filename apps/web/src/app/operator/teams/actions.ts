"use server";

import { revalidatePath } from "next/cache";
import { backendRequest } from "@/lib/backend";

export type RevealKeyResult = { secret: string } | { error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server actions run as POST and their results are never cached. The value
// goes only to the operator who asked; it is not logged or stored here.
export async function revealTeamApiKey(
  organizationId: string,
  keyId: string,
): Promise<RevealKeyResult> {
  if (!uuid.test(organizationId) || !uuid.test(keyId)) return { error: "Key not found." };
  const response = await backendRequest(
    `/web/operator/teams/${organizationId}/api-keys/${keyId}/reveal`,
    { method: "POST" },
  );
  if (!response) return { error: "We couldn’t reach the server. Try again shortly." };
  if (response.status === 403)
    return { error: "You no longer have operator access. Reload the page." };
  let body: { secret?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {}
  if (response.ok && typeof body.secret === "string") return { secret: body.secret };
  // Our own 4xx and 503 messages are safe to show; other failures are not.
  if (typeof body.error === "string" && (response.status < 500 || response.status === 503))
    return { error: body.error };
  return { error: "We couldn’t show this key. Try again shortly." };
}

export interface TeamChangeState {
  error?: string;
}

async function teamChange(path: string, organizationId: string): Promise<TeamChangeState> {
  const response = await backendRequest(path, { method: "POST" });
  if (!response) return { error: "We couldn’t reach the server. Try again shortly." };
  if (response.status === 403)
    return { error: "You no longer have operator access. Reload the page." };
  if (!response.ok) {
    let body: { error?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {}
    return {
      error:
        typeof body.error === "string" ? body.error : "The change didn’t go through. Try again.",
    };
  }
  revalidatePath(`/operator/teams/${organizationId}`);
  revalidatePath("/operator/teams");
  return {};
}

export async function revokeTeamApiKey(
  _previous: TeamChangeState,
  form: FormData,
): Promise<TeamChangeState> {
  const org = String(form.get("organizationId"));
  const id = String(form.get("keyId"));
  if (!uuid.test(org) || !uuid.test(id)) return { error: "Key not found." };
  return teamChange(`/web/operator/teams/${org}/api-keys/${id}/revoke`, org);
}

export async function removeTeamAdministrator(
  _previous: TeamChangeState,
  form: FormData,
): Promise<TeamChangeState> {
  const org = String(form.get("organizationId"));
  const id = String(form.get("memberId"));
  if (!uuid.test(org) || !uuid.test(id)) return { error: "Administrator not found." };
  return teamChange(`/web/operator/teams/${org}/administrators/${id}/remove`, org);
}
