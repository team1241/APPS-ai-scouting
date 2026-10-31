import pg from "pg";

// Close idle connections fast so Neon can suspend outside event mode.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
});

import { Kysely, PostgresDialect } from "kysely";
import type { DB } from "./db.generated.ts";

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
