"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { backendRequest } from "@/lib/backend";

export interface ReviewState {
  status: "idle" | "error" | "done";
  message?: string;
  fieldError?: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable: ReviewState = {
  status: "error",
  message: "We couldn’t complete that action. Try again.",
};
const invitationMessage = {
  sent: "Invitation sent.",
  failed:
    "The invitation was not sent. The applicant may already have an account. Try Resend invitation.",
  unavailable: "Email invitations are not configured. Send the invitation from Clerk.",
} as const;

async function errorMessage(response: Response) {
  try {
    const data = (await response.json()) as { error?: unknown };
    return typeof data.error === "string" ? data.error : unavailable.message;
  } catch {
    return unavailable.message;
  }
}

function applicationId(formData: FormData) {
  const id = formData.get("applicationId");
  return typeof id === "string" && uuid.test(id) ? id : null;
}

export async function approveApplication(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const id = applicationId(formData);
  const name = formData.get("organizationName");
  const organizationName = typeof name === "string" ? name.trim() : "";
  if (!id) return unavailable;
  if (!organizationName || organizationName.length > 120)
    return { status: "error", fieldError: "Enter a team name using 120 characters or fewer." };
  const response = await backendRequest(`/web/operator/applications/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ organizationName }),
  });
  if (!response) return unavailable;
  if (response.status === 400)
    return { status: "error", fieldError: "Enter a team name using 120 characters or fewer." };
  if (!response.ok) return { status: "error", message: await errorMessage(response) };
  revalidatePath("/operator");
  // The pending row disappears on success, so the page reports the outcome.
  redirect(`/operator?approved=${id}`);
}

export async function rejectApplication(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const id = applicationId(formData);
  if (!id) return unavailable;
  const response = await backendRequest(`/web/operator/applications/${id}/reject`, {
    method: "POST",
  });
  if (!response) return unavailable;
  if (!response.ok) return { status: "error", message: await errorMessage(response) };
  revalidatePath("/operator");
  redirect(`/operator?rejected=${id}`);
}

export async function resendInvitation(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const id = applicationId(formData);
  if (!id) return unavailable;
  const response = await backendRequest(`/web/operator/applications/${id}/invitation`, {
    method: "POST",
  });
  if (!response) return unavailable;
  if (!response.ok) return { status: "error", message: await errorMessage(response) };
  const data = (await response.json()) as { invitation: keyof typeof invitationMessage };
  revalidatePath("/operator");
  return {
    status: data.invitation === "sent" ? "done" : "error",
    message: invitationMessage[data.invitation] ?? invitationMessage.failed,
  };
}
