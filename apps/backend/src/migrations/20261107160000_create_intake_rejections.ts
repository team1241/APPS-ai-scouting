import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE intake_rejection (
      organization_id uuid NOT NULL REFERENCES organization(id),
      channel text NOT NULL,
      external_update_id text NOT NULL,
      reason text NOT NULL CHECK(reason IN ('no_active_event','invalid_event','legacy_session')),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(organization_id,channel,external_update_id)
    );
    ALTER TABLE intake_rejection ENABLE ROW LEVEL SECURITY;
    ALTER TABLE intake_rejection FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON intake_rejection
      USING(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)
      WITH CHECK(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT SELECT,INSERT ON intake_rejection TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}
export async function down(db: Kysely<any>) {
  await db.schema.dropTable("intake_rejection").execute();
}
