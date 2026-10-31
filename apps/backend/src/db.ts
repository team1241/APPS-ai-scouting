import pg from "pg";

// Close idle connections fast so Neon can suspend outside event mode.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
});

// Network failures can arrive between queries as EventEmitter errors. The pool
// discards broken connections; query failures still reach their caller for retry.
pool.on("error", () => console.error("Idle database connection failed"));
pool.on("connect", (client) => {
  client.on("error", () => console.error("Database connection interrupted"));
});

import { Kysely, PostgresDialect } from "kysely";
import type { DB } from "./db.generated.ts";

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
