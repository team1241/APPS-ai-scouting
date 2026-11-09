import { Hono } from "hono";
import { uuidPattern } from "./event-config.ts";
import { telegramAdmin } from "./repositories/telegram-connect.ts";
import type { AdminOrganization } from "./repositories/web-admin.ts";

export function webAdminRoutes(deps: {
  verify: ((request: Request) => Promise<string | null>) | null;
  organizations: (subject: string) => Promise<AdminOrganization[]>;
  // Links an account invited through an approved application or operator invitation.
  claim: ((subject: string) => Promise<boolean>) | null;
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
  app.onError((_error, c) => c.json({ error: "Administration unavailable" }, 503));
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
  return app;
}
