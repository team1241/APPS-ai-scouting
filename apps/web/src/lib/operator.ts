import "server-only";
import { backendRequest } from "@/lib/backend";

export interface ReviewApplication {
  id: string;
  name: string;
  email: string;
  teamNumber: number;
  role: "mentor" | "lead_mentor" | "teacher" | "other";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  organizationId: string | null;
  invitedAt: string | null;
  claimedAt: string | null;
}

export type OperatorAccess = { name: string } | "denied" | null;

// Returns the operator profile, "denied" for signed-in non-operators, or null
// when the backend cannot answer.
export async function operatorAccess(): Promise<OperatorAccess> {
  const response = await backendRequest("/web/operator");
  if (!response) return null;
  if (response.status === 403) return "denied";
  if (!response.ok) return null;
  const data = (await response.json()) as { operator: { name: string } };
  return data.operator;
}

export async function reviewApplications(
  status: "pending" | "reviewed",
): Promise<ReviewApplication[] | null> {
  const response = await backendRequest(`/web/operator/applications?status=${status}`);
  if (!response?.ok) return null;
  const data = (await response.json()) as { applications: ReviewApplication[] };
  return data.applications;
}

export interface PlatformOperator {
  clerkUserId: string;
  name: string;
  createdAt: string;
  addedByName: string | null;
  isSelf: boolean;
}

export async function platformOperators(): Promise<PlatformOperator[] | null> {
  const response = await backendRequest("/web/operator/operators");
  if (!response?.ok) return null;
  const data = (await response.json()) as { operators: PlatformOperator[] };
  return data.operators;
}

export interface OperatorInvitation {
  id: string;
  email: string;
  name: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  sent: boolean;
}

export async function operatorInvitations(): Promise<OperatorInvitation[] | null> {
  const response = await backendRequest("/web/operator/operator-invitations");
  if (!response?.ok) return null;
  const data = (await response.json()) as { invitations: OperatorInvitation[] };
  return data.invitations;
}
