import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    ALTER TABLE raw_entry ADD CONSTRAINT raw_entry_tenant_id_unique UNIQUE(organization_id,id);
    ALTER TABLE raw_entry ADD COLUMN parent_entry_id uuid,
      ADD COLUMN extraction_result jsonb,
      ADD COLUMN processing_started_at timestamptz,
      ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE raw_entry ADD CONSTRAINT raw_entry_parent_fk FOREIGN KEY(organization_id,parent_entry_id) REFERENCES raw_entry(organization_id,id);
    CREATE INDEX raw_entry_parent_idx ON raw_entry(organization_id,parent_entry_id);
    CREATE INDEX raw_entry_followup_idx ON raw_entry(organization_id,member_id,follow_up_message_id);
  `.execute(db);
}
export async function down(db: Kysely<any>) {
  await sql`ALTER TABLE raw_entry DROP CONSTRAINT raw_entry_parent_fk;
    DROP INDEX raw_entry_parent_idx; DROP INDEX raw_entry_followup_idx;
    ALTER TABLE raw_entry DROP COLUMN parent_entry_id, DROP COLUMN extraction_result,
      DROP COLUMN processing_started_at, DROP COLUMN processing_attempts, DROP COLUMN next_attempt_at;
    ALTER TABLE raw_entry DROP CONSTRAINT raw_entry_tenant_id_unique;`.execute(db);
}
