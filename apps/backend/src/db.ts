import pg from "pg";

// Close idle connections fast so Neon can suspend outside event mode.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
});
