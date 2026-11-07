import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE observation_flag (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      member_id uuid NOT NULL,
      external_update_id text NOT NULL,
      team_number integer NOT NULL CHECK(team_number > 0),
      requested_match_label text,
      note text,
      command_text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,external_update_id),
      FOREIGN KEY(organization_id,revision_id) REFERENCES observation_revision(organization_id,id),
      FOREIGN KEY(organization_id,member_id) REFERENCES member(organization_id,id)
    );
    CREATE INDEX observation_flag_team_idx ON observation_flag(organization_id,created_at DESC);
    ALTER TABLE observation_flag ENABLE ROW LEVEL SECURITY;
    ALTER TABLE observation_flag FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON observation_flag
      USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid)
      WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
    CREATE TRIGGER immutable_flag BEFORE UPDATE OR DELETE ON observation_flag FOR EACH ROW EXECUTE FUNCTION reject_published_mutation();
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
      GRANT SELECT,INSERT ON observation_flag TO ai_scouting_backend;
    END IF; END $$;
  `.execute(db);
}
export async function down() {
  throw Error("Flag history requires a forward migration");
}
