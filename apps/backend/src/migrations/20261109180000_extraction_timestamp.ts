import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`ALTER TABLE raw_entry ADD COLUMN extracted_at timestamptz`.execute(db);
  // Old drafts have no exact extraction time; migration time is their first export update.
  await sql`UPDATE raw_entry r SET extracted_at = coalesce(
    (SELECT created_at FROM observation_revision v
     WHERE v.organization_id = r.organization_id AND v.session_id = r.id), now())
    WHERE extraction_result IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<any>) {
  await db.schema.alterTable("raw_entry").dropColumn("extracted_at").execute();
}
