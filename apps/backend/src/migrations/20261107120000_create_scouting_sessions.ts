import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE scouting_session (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      member_id uuid NOT NULL,
      match_label text,
      team_number integer CHECK(team_number > 0),
      specification_version text NOT NULL,
      status text NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting','complete')),
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      UNIQUE(organization_id,id),
      FOREIGN KEY(organization_id,id) REFERENCES raw_entry(organization_id,id) ON DELETE CASCADE,
      FOREIGN KEY(organization_id,member_id) REFERENCES member(organization_id,id)
    );
    ALTER TABLE scouting_session ENABLE ROW LEVEL SECURITY;
    ALTER TABLE scouting_session FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON scouting_session
      USING(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)
      WITH CHECK(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT SELECT,INSERT,UPDATE ON scouting_session TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}
export async function down(db: Kysely<any>) {
  await db.schema.dropTable("scouting_session").execute();
}
