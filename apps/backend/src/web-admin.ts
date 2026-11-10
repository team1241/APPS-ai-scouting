import { Hono } from "hono";
import { ProviderUnavailable } from "./api-keys.ts";
import { uuidPattern } from "./event-config.ts";
import type { ApiKeySummary } from "./repositories/api-keys.ts";
import { telegramAdmin } from "./repositories/telegram-connect.ts";
import type { AdminOrganization } from "./repositories/web-admin.ts";
import { type SpecificationDeps, specificationRoutes } from "./specification-routes.ts";
import { type TeamAdminDeps, teamAdminRoutes } from "./team-admin-routes.ts";

export function webAdminRoutes(deps: {
  verify: ((request: Request) => Promise<string | null>) | null;
  organizations: (subject: string) => Promise<AdminOrganization[]>;
  // Links an account invited through an approved application, operator
  // invitation or team admin invitation.
  claim: ((subject: string) => Promise<boolean>) | null;
  // Null when Unkey or the encryption key is not configured.
  apiKeys?: {
    list(org: string, subject: string): Promise<ApiKeySummary[] | null>;
    create(org: string, subject: string, name: string): Promise<ApiKeySummary | "limit" | null>;
    revoke(org: string, subject: string, id: string): Promise<boolean | null>;
  } | null;
  // Team admin invitations (#40). Omitted in tests that do not need them.
  teamAdmins?: TeamAdminDeps;
  // Scouting specification drafts, publication and assignment (#46).
  specifications?: SpecificationDeps;
}) {
  const app = new Hono<{ Variables: { subject: string } }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    if (!deps.verify) return c.json({ error: "Web authentication unavailable" }, 503);
    const subject = await deps.verify(c.req.raw);
    if (!subject) return c.json({ error: "Sign-in required" }, 401);
    c.set("subject", subject);
    await next();
  });
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof ProviderUnavailable
            ? "The API key service is unavailable"
            : "Administration unavailable",
      },
      503,
    ),
  );
  app.get("/organizations", async (c) => {
    const subject = c.get("subject");
    let organizations = await deps.organizations(subject);
    // Only accounts without any team call Clerk, so existing admins skip it.
    if (!organizations.length && deps.claim) {
      try {
        if (await deps.claim(subject)) organizations = await deps.organizations(subject);
      } catch {
        console.error("Invitation claim failed");
      }
    }
    return c.json({ organizations });
  });
  app.get("/organizations/:id", async (c) => {
    const id = c.req.param("id");
    if (!uuidPattern.test(id)) return c.json({ error: "Organization unavailable" }, 404);
    const organization = (await deps.organizations(c.get("subject"))).find((org) => org.id === id);
    return organization
      ? c.json({ organization })
      : c.json({ error: "Organization unavailable" }, 404);
  });
  for (const action of ["state", "connect", "disconnect"] as const) {
    app.on(
      action === "state" ? "GET" : "POST",
      `/organizations/:id/telegram/${action}`,
      async (c) => {
        const id = c.req.param("id") ?? "";
        if (!uuidPattern.test(id)) return c.json({ error: "Organization unavailable" }, 404);
        const username = process.env.TELEGRAM_BOT_USERNAME;
        if (action === "connect" && !username?.match(/^[A-Za-z0-9_]{5,32}$/))
          return c.json({ error: "Telegram connection unavailable" }, 503);
        const result = await telegramAdmin(id, c.get("subject"), action);
        if (!result) return c.json({ error: "Organization unavailable" }, 404);
        return c.json(
          "token" in result
            ? {
                url: `https://t.me/${username}?start=connect_${result.token}`,
                expiresAt: result.expiresAt,
              }
            : result,
        );
      },
    );
  }
  if (deps.teamAdmins) app.route("/", teamAdminRoutes(deps.teamAdmins));
  if (deps.specifications) app.route("/", specificationRoutes(deps.specifications));
  const keys = deps.apiKeys;
  const keysPath = "/organizations/:id/api-keys";
  // The wildcard also matches the list path itself.
  app.use(`${keysPath}/*`, async (c, next) => {
    if (!uuidPattern.test(c.req.param("id") ?? ""))
      return c.json({ error: "Organization unavailable" }, 404);
    if (!keys) return c.json({ error: "API keys are not configured" }, 503);
    await next();
  });
  app.get(keysPath, async (c) => {
    const list = await keys?.list(c.req.param("id"), c.get("subject"));
    return list ? c.json({ keys: list }) : c.json({ error: "Organization unavailable" }, 404);
  });
  app.post(keysPath, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60)
      return c.json({ error: "Enter a name of 1 to 60 characters" }, 400);
    const key = await keys?.create(c.req.param("id"), c.get("subject"), name);
    if (key === "limit") return c.json({ error: "Revoke a key before you create another" }, 409);
    return key ? c.json({ key }, 201) : c.json({ error: "Organization unavailable" }, 404);
  });
  app.post(`${keysPath}/:keyId/revoke`, async (c) => {
    const keyId = c.req.param("keyId");
    if (!uuidPattern.test(keyId)) return c.json({ error: "Key not found" }, 404);
    const result = await keys?.revoke(c.req.param("id"), c.get("subject"), keyId);
    if (result === null) return c.json({ error: "Organization unavailable" }, 404);
    return result ? c.json({ revoked: true }) : c.json({ error: "Key not found" }, 404);
  });
  return app;
}
