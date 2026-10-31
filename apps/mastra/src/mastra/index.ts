import { Mastra } from "@mastra/core/mastra";
import { SimpleAuth } from "@mastra/core/server";
import { PostgresStore } from "@mastra/pg";

import { extractor } from "./agents/extractor.ts";
import { extractionWorkflow } from "./workflows/extraction.ts";

export const mastra = new Mastra({
  agents: { extractor },
  workflows: { "scouting-extraction": extractionWorkflow },
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
    auth: process.env.MASTRA_SERVICE_TOKEN
      ? new SimpleAuth({
          tokens: { [process.env.MASTRA_SERVICE_TOKEN]: { id: "scouting-backend" } },
          authorizeUser: (_user, request) => {
            const req = request instanceof Request ? request : request.raw;
            return (
              req?.method === "POST" &&
              new URL(req.url).pathname === "/api/workflows/scouting-extraction/start-async"
            );
          },
        })
      : undefined,
    port: Number(process.env.PORT ?? 4111),
  },
});
