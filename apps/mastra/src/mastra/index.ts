import { Mastra } from "@mastra/core/mastra";

export const mastra = new Mastra({
  server: {
    port: Number(process.env.PORT ?? 4111),
  },
});
