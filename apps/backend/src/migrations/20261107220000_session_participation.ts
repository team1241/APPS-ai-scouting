import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    ALTER TABLE intake_rejection DROP CONSTRAINT intake_rejection_reason_check;
    ALTER TABLE intake_rejection ADD CONSTRAINT intake_rejection_reason_check CHECK(reason IN ('no_active_event','invalid_event','legacy_session','completed_session'));
    ALTER TABLE event_match ADD CONSTRAINT event_match_scope_id UNIQUE(organization_id,event_id,id);
    ALTER TABLE scouting_session
      ADD COLUMN match_id uuid,
      ADD COLUMN validation_result jsonb,
      ADD CONSTRAINT session_match_event_fk FOREIGN KEY(organization_id,event_id,match_id)
        REFERENCES event_match(organization_id,event_id,id);
  `.execute(db);
}
export async function down(db: Kysely<any>) {
  // Retain rejection receipts written by this version during rollback.
  await sql`
    ALTER TABLE scouting_session DROP COLUMN match_id, DROP COLUMN validation_result;
    ALTER TABLE event_match DROP CONSTRAINT event_match_scope_id;
    ALTER TABLE intake_rejection DROP CONSTRAINT intake_rejection_reason_check;
    ALTER TABLE intake_rejection ADD CONSTRAINT intake_rejection_reason_check
      CHECK(reason IN ('no_active_event','invalid_event','legacy_session')) NOT VALID;
  `.execute(db);
}
