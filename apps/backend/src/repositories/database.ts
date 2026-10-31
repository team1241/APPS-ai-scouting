import { sql } from "kysely";
import { db } from "../db.ts";

export async function checkDatabase() {
  await sql`select 1`.execute(db);
}

export function closeDatabase() {
  return db.destroy();
}
