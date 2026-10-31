import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
      GRANT SELECT,INSERT,UPDATE ON invitation TO ai_scouting_backend;
      GRANT INSERT ON member,channel_identity TO ai_scouting_backend;
    END IF;
  END $$`.execute(db);
}
export async function down(db: Kysely<any>) {
  await sql`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
      REVOKE SELECT,INSERT,UPDATE ON invitation FROM ai_scouting_backend;
      REVOKE INSERT ON member,channel_identity FROM ai_scouting_backend;
    END IF;
  END $$`.execute(db);
}
