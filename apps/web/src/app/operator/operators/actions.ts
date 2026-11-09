"use server";

import { revalidatePath } from "next/cache";
import { backendRequest } from "@/lib/backend";

export interface OperatorFormState {
  status: "idle" | "error" | "done";
  message?: string;
  errors: Record<string, string>;
  values: { name: string; email: string };
}

export interface RemoveState {
  status: "idle" | "error";
  message?: string;
}

const unavailable = "We couldn’t complete that action. Try again.";

async function readError(response: Response) {
  try {
    return (await response.json()) as { error?: unknown; errors?: unknown };
  } catch {
    return {};
  }
}

export async function addOperator(
  _previous: OperatorFormState,
  formData: FormData,
): Promise<OperatorFormState> {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const values = { name: text("name"), email: text("email") };
  const response = await backendRequest("/web/operator/operators", {
    method: "POST",
    body: JSON.stringify(values),
  });
  if (!response) return { status: "error", message: unavailable, errors: {}, values };
  if (response.status === 202) {
    revalidatePath("/operator/operators");
    return {
      status: "done",
      message: `Invitation sent to ${values.email}. ${values.name} becomes an operator when they first sign in.`,
      errors: {},
      values: { name: "", email: "" },
    };
  }
  if (response.status === 201) {
    revalidatePath("/operator/operators");
    return {
      status: "done",
      message: `${values.name} is now an operator.`,
      errors: {},
      values: { name: "", email: "" },
    };
  }
  const data = await readError(response);
  const errors =
    data.errors && typeof data.errors === "object"
      ? (Object.fromEntries(
          Object.entries(data.errors).filter(
            ([key, value]) => ["name", "email"].includes(key) && typeof value === "string",
          ),
        ) as Record<string, string>)
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

export async function removeOperator(
  _previous: RemoveState,
  formData: FormData,
): Promise<RemoveState> {
  const id = formData.get("clerkUserId");
  if (typeof id !== "string" || !/^user_[A-Za-z0-9]+$/.test(id))
    return { status: "error", message: unavailable };
  const response = await backendRequest(`/web/operator/operators/${id}`, { method: "DELETE" });
  if (!response) return { status: "error", message: unavailable };
  if (!response.ok) {
    const data = await readError(response);
    return { status: "error", message: typeof data.error === "string" ? data.error : unavailable };
  }
  revalidatePath("/operator/operators");
  return { status: "idle" };
}

export interface InvitationState {
  status: "idle" | "error" | "done";
  message?: string;
}

async function invitationAction(formData: FormData, method: "POST" | "DELETE") {
  const id = formData.get("invitationId");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    return { status: "error", message: unavailable } as InvitationState;
  const path =
    method === "POST"
      ? `/web/operator/operator-invitations/${id}/resend`
      : `/web/operator/operator-invitations/${id}`;
  const response = await backendRequest(path, { method });
  if (!response) return { status: "error", message: unavailable } as InvitationState;
  if (!response.ok) {
    const data = await readError(response);
    return {
      status: "error",
      message: typeof data.error === "string" ? data.error : unavailable,
    } as InvitationState;
  }
  revalidatePath("/operator/operators");
  return {
    status: "done",
    message: method === "POST" ? "Invitation sent again." : "Invitation cancelled.",
  } as InvitationState;
}

export async function resendOperatorInvitation(_previous: InvitationState, formData: FormData) {
  return invitationAction(formData, "POST");
}

export async function cancelOperatorInvitation(_previous: InvitationState, formData: FormData) {
  return invitationAction(formData, "DELETE");
}
