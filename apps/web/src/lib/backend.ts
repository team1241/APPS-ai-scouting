import "server-only";
import { auth } from "@clerk/nextjs/server";

export interface Organization {
  id: string;
  name: string;
  teamNumber: number;
}

export async function authorizedOrganizations(): Promise<Organization[] | null> {
  const { userId, getToken, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  const base = process.env.BACKEND_URL;
  if (!base) return null;
  const token = await getToken();
  if (!token) return redirectToSignIn();
  let response: Response;
  try {
    const url = new URL("/web/organizations", base);
    if (
      url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))
    )
      return null;
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (response.status === 401) return redirectToSignIn();
  if (!response.ok) return null;
  const data = (await response.json()) as { organizations: Organization[] };
  return data.organizations;
}
