import { readFileSync } from "node:fs";
import { type ObservationKind, observationKinds } from "@ai-scouting/scouting";
import { Hono } from "hono";
import { type ApiKeyVerification, ProviderUnavailable } from "./api-keys.ts";
import { uuidPattern } from "./event-config.ts";
import type { ScoutingReads } from "./repositories/scouting-data.ts";
import type { AdminOrganization } from "./repositories/web-admin.ts";
import { InvalidPage, type ReadScope, readPage } from "./scouting-data.ts";

const openapi = JSON.parse(
  readFileSync(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
);

// Read-only data API for team integrations. The organization comes only from the
// verified key, never from the request, so a key cannot select another team's data.
export function dataApiRoutes(deps: {
  scouting?: ScoutingReads;
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
    error instanceof InvalidPage
      ? c.json({ error: error.message }, 400)
      : c.json(
          {
            error:
              error instanceof ProviderUnavailable
                ? "API key verification is unavailable"
                : "Data unavailable",
          },
          503,
        ),
  );
  app.get("/openapi.json", (c) => c.json(openapi));
  // Lets an integration check its key and see which team it reads.
  app.get("/organization", async (c) => {
    const organization = await deps.organization(c.get("organizationId"));
    return organization
      ? c.json({ organization })
      : c.json({ error: "Organization unavailable" }, 404);
  });
  const team = (value: string) => (/^[1-9]\d{0,5}$/.test(value) ? Number(value) : null);
  app.get("/teams/:teamNumber/events", async (c) => {
    const teamNumber = team(c.req.param("teamNumber"));
    if (!teamNumber) return c.json({ error: "Invalid team number" }, 400);
    const scope: ReadScope = { organizationId: c.get("organizationId"), teamNumber };
    const page = readPage(c.req.query(), scope);
    if (!deps.scouting) return c.json({ error: "Data unavailable" }, 503);
    return c.json(await deps.scouting.events(scope, page));
  });
  for (const path of [
    "/events/:eventId/observations",
    "/events/:eventId/teams/:teamNumber/observations",
  ]) {
    app.get(path, async (c) => {
      const eventId = c.req.param("eventId");
      if (!eventId || !uuidPattern.test(eventId)) return c.json({ error: "Invalid event ID" }, 400);
      const teamParam = c.req.param("teamNumber");
      const teamNumber = teamParam === undefined ? undefined : team(teamParam);
      if (teamNumber === null) return c.json({ error: "Invalid team number" }, 400);
      const scope: ReadScope = { organizationId: c.get("organizationId"), eventId, teamNumber };
      const page = readPage(c.req.query(), scope);
      if (!deps.scouting) return c.json({ error: "Data unavailable" }, 503);
      const result = await deps.scouting.observations(scope, page);
      return result ? c.json(result) : c.json({ error: "Event not found" }, 404);
    });
  }
  app.get("/events/:eventId/specifications/:version", async (c) => {
    const eventId = c.req.param("eventId");
    if (!uuidPattern.test(eventId)) return c.json({ error: "Invalid event ID" }, 400);
    const query = c.req.query();
    if (Object.keys(query).some((key) => key !== "kind"))
      return c.json({ error: "Unknown query parameter" }, 400);
    const kind = query.kind ?? "match";
    if (!(observationKinds as readonly string[]).includes(kind))
      return c.json({ error: "kind must be match, pit or general" }, 400);
    if (!deps.scouting) return c.json({ error: "Data unavailable" }, 503);
    const specification = await deps.scouting.specification(
      c.get("organizationId"),
      eventId,
      c.req.param("version"),
      kind as ObservationKind,
    );
    return specification
      ? c.json({ specification })
      : c.json({ error: "Specification not found" }, 404);
  });
  app.notFound((c) => c.json({ error: "Route not found" }, 404));
  return app;
}
