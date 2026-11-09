"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { backendRequest } from "@/lib/backend";

export interface InviteAdminState {
  status: "idle" | "error" | "done";
  message?: string;
  errors: Partial<Record<"name" | "email" | "adultAttested", string>>;
  values: { name: string; email: string };
  // What happened on success, so the card can announce it.
  sent?: "email" | "account";
}

export interface AdminInvitationState {
  status: "idle" | "error" | "done";
  message?: string;
}

const unavailable = "We couldn’t complete that action. Try again shortly.";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const basePath = (org: string) => `/web/organizations/${org}/administrators`;

async function readBody(response: Response) {
  try {
    return (await response.json()) as { error?: unknown; errors?: unknown; invitation?: unknown };
  } catch {
    return {};
  }
}

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
};

export async function inviteAdministrator(
  _previous: InviteAdminState,
  form: FormData,
): Promise<InviteAdminState> {
  const org = text(form, "organizationId");
  const values = { name: text(form, "name"), email: text(form, "email") };
  const adultAttested = form.get("adultAttested") === "on";
  if (!uuid.test(org)) return { status: "error", message: unavailable, errors: {}, values };
  const response = await backendRequest(`${basePath(org)}/invitations`, {
    method: "POST",
    body: JSON.stringify({ ...values, adultAttested }),
  });
  if (!response) return { status: "error", message: unavailable, errors: {}, values };
  const data = await readBody(response);
  if (response.status === 201) {
    revalidatePath(`/admin/${org}`);
    return {
      status: "done",
      errors: {},
      values: { name: "", email: "" },
      sent: data.invitation === "account" ? "account" : "email",
      message:
        data.invitation === "account"
          ? `${values.name} already has an account. They can accept the next time they open Teams.`
          : `Invitation email sent to ${values.email.toLowerCase()}.`,
    };
  }
  const errors =
    data.errors && typeof data.errors === "object"
      ? (Object.fromEntries(
          Object.entries(data.errors).filter(
            ([key, value]) =>
              ["name", "email", "adultAttested"].includes(key) && typeof value === "string",
          ),
        ) as InviteAdminState["errors"])
      : {};
  return {
    status: "error",
    message: Object.keys(errors).length
      ? undefined
      : typeof data.error === "string"
        ? data.error
        : unavailable,
    errors,
    values,
  };
}

async function invitationAction(form: FormData, action: "resend" | "cancel") {
  const org = text(form, "organizationId");
  const id = text(form, "invitationId");
  if (!uuid.test(org) || !uuid.test(id))
    return { status: "error", message: unavailable } as AdminInvitationState;
  const response = await backendRequest(
    action === "resend"
      ? `${basePath(org)}/invitations/${id}/resend`
      : `${basePath(org)}/invitations/${id}`,
    { method: action === "resend" ? "POST" : "DELETE" },
  );
  if (!response) return { status: "error", message: unavailable } as AdminInvitationState;
  if (!response.ok) {
    const data = await readBody(response);
    // A failed resend still replaced the invitation, so the list must refresh.
    if (action === "resend") revalidatePath(`/admin/${org}`);
    return {
      status: "error",
      message: typeof data.error === "string" ? data.error : unavailable,
    } as AdminInvitationState;
  }
  revalidatePath(`/admin/${org}`);
  return {
    status: "done",
    message: action === "resend" ? "Invitation sent again." : "Invitation cancelled.",
  } as AdminInvitationState;
}

export async function resendAdministratorInvitation(
  _previous: AdminInvitationState,
  form: FormData,
) {
  return invitationAction(form, "resend");
}

export async function cancelAdministratorInvitation(
  _previous: AdminInvitationState,
  form: FormData,
) {
  return invitationAction(form, "cancel");
}

// Accepts an invitation bound to this account, then opens the team.
export async function acceptAdministratorInvitation(
  _previous: AdminInvitationState,
  form: FormData,
): Promise<AdminInvitationState> {
  const id = text(form, "invitationId");
  if (!uuid.test(id)) return { status: "error", message: unavailable };
  const response = await backendRequest(`/web/administrator-invitations/${id}/accept`, {
    method: "POST",
  });
  if (!response) return { status: "error", message: unavailable };
  const data = (await readBody(response)) as { error?: unknown; organizationId?: unknown };
  if (!response.ok || typeof data.organizationId !== "string" || !uuid.test(data.organizationId)) {
    revalidatePath("/admin");
    return {
      status: "error",
      message: response.status === 409 && typeof data.error === "string" ? data.error : unavailable,
    };
  }
  revalidatePath("/admin");
  redirect(`/admin/${data.organizationId}`);
}
