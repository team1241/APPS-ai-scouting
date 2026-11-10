import { validateContract } from "@ai-scouting/scouting";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute, SimpleAuth } from "@mastra/core/server";
import { PostgresStore } from "@mastra/pg";
import { z } from "zod";
import { extractor } from "./agents/extractor.ts";
import { runDraftTest } from "./draft-test.ts";
import { createObservability } from "./observability.ts";
import { extractTurns, sessionWorkflow } from "./workflows/extraction.ts";
import { advanceSession, sessionTurnSchema } from "./workflows/session.ts";

// Custom routes are outside SimpleAuth's default /api/* protection.
type RouteMiddleware = Extract<
  NonNullable<Parameters<typeof registerApiRoute>[1]["middleware"]>,
  (...args: never[]) => unknown
>;
const serviceAuth: RouteMiddleware = async (c, next) => {
  const token = process.env.MASTRA_SERVICE_TOKEN;
  if (token) {
    const { timingSafeEqual } = await import("node:crypto");
    const actual = Buffer.from(c.req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return c.json({ error: "Unauthorized" }, 401);
  } else if (process.env.NODE_ENV === "production") {
    return c.json({ error: "Service token required" }, 503);
  }
  await next();
};

export const mastra = new Mastra({
  agents: { extractor },
  workflows: { "scouting-session": sessionWorkflow },
  observability: createObservability(),
  storage: process.env.MASTRA_DATABASE_URL
    ? new PostgresStore({
        id: "ai-scouting-storage",
        connectionString: process.env.MASTRA_DATABASE_URL,
        schemaName: "mastra",
        max: 5,
        idleTimeoutMillis: 10_000,
      })
    : undefined,
  server: {
    apiRoutes: [
      registerApiRoute("/scouting/sessions/:runId/turn", {
        method: "POST",
        middleware: serviceAuth,
        handler: async (c) => {
          const runId = z.string().uuid().safeParse(c.req.param("runId"));
          const turn = sessionTurnSchema.safeParse(await c.req.json().catch(() => null));
          if (!runId.success || !turn.success)
            return c.json({ error: "Invalid session turn" }, 400);
          // The contract is trusted only after the same validation used at publication.
          if (!validateContract(turn.data.contract, turn.data.contract.kind).ok)
            return c.json({ error: "Invalid scouting contract" }, 400);
          // Configured storage is mandatory: a suspended session must survive restarts.
          if (!process.env.MASTRA_DATABASE_URL)
            return c.json({ error: "Session storage required" }, 503);
          try {
            const result = await advanceSession(sessionWorkflow, runId.data, turn.data);
            return c.json(result);
          } catch {
            return c.json(
              { error: "Session turn unavailable; retry or inspect workflow state" },
              503,
            );
          }
        },
      }),
      // Admin draft tests (#49): stateless, so no session storage is needed.
      registerApiRoute("/scouting/draft-test", {
        method: "POST",
        middleware: serviceAuth,
        handler: async (c) => {
          const { status, body } = await runDraftTest(
            extractTurns,
            await c.req.json().catch(() => null),
          );
          return c.json(body, status);
        },
      }),
    ],
    auth: process.env.MASTRA_SERVICE_TOKEN
      ? new SimpleAuth({
          tokens: { [process.env.MASTRA_SERVICE_TOKEN]: { id: "scouting-backend" } },
          authorizeUser: (_user, request) => {
            const req = request instanceof Request ? request : request.raw;
            return (
              req?.method === "POST" &&
              /^\/scouting\/(sessions\/[a-f0-9-]+\/turn|draft-test)$/.test(
                new URL(req.url).pathname,
              )
            );
          },
        })
      : undefined,
    port: Number(process.env.PORT ?? 4111),
  },
});
