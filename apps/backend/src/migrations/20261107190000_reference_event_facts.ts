import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`ALTER TABLE event ADD COLUMN provider_facts jsonb NOT NULL DEFAULT '{}'`.execute(db);
}
export async function down(db: Kysely<any>) {
  await sql`ALTER TABLE event DROP COLUMN provider_facts`.execute(db);
}
