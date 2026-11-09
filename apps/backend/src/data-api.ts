import { Hono } from "hono";
import { type ApiKeyVerification, ProviderUnavailable } from "./api-keys.ts";
import { uuidPattern } from "./event-config.ts";
import type { AdminOrganization } from "./repositories/web-admin.ts";

// Read-only data API for team integrations. The organization comes only from the
// verified key, never from the request, so a key cannot select another team's data.
export function dataApiRoutes(deps: {
  verify: ((key: string) => Promise<ApiKeyVerification>) | null;
  active: (org: string, providerKeyId: string) => Promise<boolean>;
  organization: (org: string) => Promise<AdminOrganization | undefined>;
}) {
  const app = new Hono<{ Variables: { organizationId: string } }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    if (!deps.verify) return c.json({ error: "API keys are not configured" }, 503);
    const key = /^Bearer (\S{1,512})$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (!key) return c.json({ error: "API key required" }, 401);
    // No caching: every request is verified, so a revoked key stops working at once.
    let result: ApiKeyVerification;
    try {
      result = await deps.verify(key);
    } catch {
      console.error("API key verification unavailable");
      return c.json({ error: "API key verification is unavailable" }, 503);
    }
    if (!result.valid)
      return result.code === "rate_limited"
        ? c.json({ error: "Rate limit exceeded" }, 429)
        : c.json({ error: "Invalid API key" }, 401);
    if (
      !uuidPattern.test(result.organizationId) ||
      !(await deps.active(result.organizationId, result.keyId))
    )
      return c.json({ error: "Invalid API key" }, 401);
    c.set("organizationId", result.organizationId);
    await next();
  });
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof ProviderUnavailable
            ? "API key verification is unavailable"
            : "Data unavailable",
      },
      503,
    ),
  );
  // Lets an integration check its key and see which team it reads.
  app.get("/organization", async (c) => {
    const organization = await deps.organization(c.get("organizationId"));
    return organization
      ? c.json({ organization })
      : c.json({ error: "Organization unavailable" }, 404);
  });
  return app;
}
