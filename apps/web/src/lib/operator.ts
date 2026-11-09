import "server-only";
import { cache } from "react";
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

export type OperatorAccess = { name: string; waiting: number } | "denied" | null;

// Returns the operator profile, "denied" for signed-in non-operators, or null
// when the backend cannot answer.
export const operatorAccess = cache(async (): Promise<OperatorAccess> => {
  const response = await backendRequest("/web/operator");
  if (!response) return null;
  if (response.status === 403) return "denied";
  if (!response.ok) return null;
  const data = (await response.json()) as { operator: { name: string; waiting: number } };
  return data.operator;
});

// Both review lists in one backend request.
export async function applicationLists(): Promise<{
  pending: ReviewApplication[];
  reviewed: ReviewApplication[];
} | null> {
  const response = await backendRequest("/web/operator/applications");
  if (!response?.ok) return null;
  return (await response.json()) as { pending: ReviewApplication[]; reviewed: ReviewApplication[] };
}

export interface PlatformOperator {
  clerkUserId: string;
  name: string;
  createdAt: string;
  addedByName: string | null;
  isSelf: boolean;
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

// Operators and open invitations in one backend request.
export async function operatorLists(): Promise<{
  operators: PlatformOperator[];
  invitations: OperatorInvitation[];
} | null> {
  const response = await backendRequest("/web/operator/operators");
  if (!response?.ok) return null;
  return (await response.json()) as {
    operators: PlatformOperator[];
    invitations: OperatorInvitation[];
  };
}

export interface DirectoryTeam {
  id: string;
  name: string;
  teamNumber: number;
  createdAt: string;
  adminCount: number;
  webAdminCount: number;
  pendingInvitationCount: number;
  activeKeyCount: number;
}

export interface DirectoryPage {
  teams: DirectoryTeam[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DirectoryTeamDetail {
  team: { id: string; name: string; teamNumber: number; createdAt: string };
  administrators: {
    memberId: string;
    name: string;
    addedAt: string;
    webAccess: "none" | "approved" | "linked";
    approvedAt: string | null;
  }[];
  invitations: {
    id: string;
    name: string;
    existingAccount: boolean;
    invitedByName: string | null;
    createdAt: string;
    expiresAt: string;
    sent: boolean;
  }[];
  // Metadata only. Values come from the reveal action, one key at a time.
  keys: {
    id: string;
    name: string;
    start: string;
    rateLimitPerMinute: number;
    createdAt: string;
    revokedAt: string | null;
  }[];
}

// One page of every registered team. Null when the backend cannot answer.
export async function directoryPage(search: string, page: number): Promise<DirectoryPage | null> {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("q", search);
  const response = await backendRequest(`/web/operator/teams?${params}`);
  if (!response?.ok) return null;
  return (await response.json()) as DirectoryPage;
}

// "missing" for an unknown team; null when the backend cannot answer.
export async function directoryTeam(
  organizationId: string,
): Promise<DirectoryTeamDetail | "missing" | null> {
  const response = await backendRequest(
    `/web/operator/teams/${encodeURIComponent(organizationId)}`,
  );
  if (response?.status === 404) return "missing";
  if (!response?.ok) return null;
  return (await response.json()) as DirectoryTeamDetail;
}
