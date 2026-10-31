import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { pool } from "./db.ts";

const app = new Hono();

// No database query, so a wake-up ping does not wake Neon.
app.get("/health", (c) => c.json({ ok: true }));

app.get("/health/db", async (c) => {
  await pool.query("select 1");
  return c.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`backend listening on ${port}`);
});
