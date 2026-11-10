import "server-only";
import { auth } from "@clerk/nextjs/server";

export interface Organization {
  id: string;
  name: string;
  teamNumber: number;
}

// Calls the backend with the current Clerk session. Returns null when the
// backend is unreachable or not configured; redirects when sign-in is needed.
export async function backendRequest(
  path: string,
  init: RequestInit = {},
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
) {
  const { userId, getToken, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  const base = process.env.BACKEND_URL;
  if (!base) return null;
  const token = await getToken();
  if (!token) return redirectToSignIn();
  let response: Response;
  try {
    const url = new URL(path, base);
    if (
      url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))
    )
      return null;
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (response.status === 401) return redirectToSignIn();
  return response;
}

export async function authorizedOrganizations(): Promise<Organization[] | null> {
  const response = await backendRequest("/web/organizations");
  if (!response?.ok) return null;
  const data = (await response.json()) as { organizations: Organization[] };
  return data.organizations;
}
