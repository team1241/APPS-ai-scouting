import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";

export const mastra = new Mastra({
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
    port: Number(process.env.PORT ?? 4111),
  },
});
