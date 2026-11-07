import { requirements } from "@ai-scouting/scouting";
import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE published_specification (
      organization_id uuid NOT NULL REFERENCES organization(id),
      season integer NOT NULL,
      kind text NOT NULL CHECK(kind IN ('match','pit','general')),
      version text NOT NULL,
      document jsonb NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(organization_id,season,kind,version)
    );
    ALTER TABLE scouting_session ADD COLUMN replaces_revision_id uuid, ADD COLUMN reextraction boolean NOT NULL DEFAULT false;
    ALTER TABLE scouting_session DROP CONSTRAINT scouting_session_status_check;
    ALTER TABLE scouting_session ADD CONSTRAINT scouting_session_status_check CHECK(status IN ('collecting','complete','superseded'));
    CREATE TABLE observation_revision (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      session_id uuid NOT NULL UNIQUE,
      member_id uuid NOT NULL,
      event_id uuid NOT NULL,
      match_id uuid,
      team_number integer NOT NULL,
      specification_version text NOT NULL,
      season integer NOT NULL,
      kind text NOT NULL DEFAULT 'match' CHECK(kind IN ('match','pit','general')),
      values jsonb NOT NULL,
      validation jsonb NOT NULL,
      outcome text NOT NULL CHECK(outcome IN ('validated','warning_acknowledged','unchecked')),
      provenance jsonb NOT NULL,
      replaces_revision_id uuid UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,id),
      FOREIGN KEY(organization_id,session_id) REFERENCES scouting_session(organization_id,id),
      FOREIGN KEY(organization_id,member_id) REFERENCES member(organization_id,id),
      FOREIGN KEY(organization_id,event_id) REFERENCES event(organization_id,id),
      FOREIGN KEY(organization_id,event_id,match_id) REFERENCES event_match(organization_id,event_id,id),
      FOREIGN KEY(organization_id,season,kind,specification_version) REFERENCES published_specification(organization_id,season,kind,version),
      FOREIGN KEY(organization_id,replaces_revision_id) REFERENCES observation_revision(organization_id,id)
    );
    ALTER TABLE scouting_session ADD FOREIGN KEY(organization_id,replaces_revision_id) REFERENCES observation_revision(organization_id,id);
    CREATE FUNCTION reject_published_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published records are immutable'; END $$;
    CREATE TRIGGER immutable_specification BEFORE UPDATE OR DELETE ON published_specification FOR EACH ROW EXECUTE FUNCTION reject_published_mutation();
    CREATE TRIGGER immutable_observation BEFORE UPDATE OR DELETE ON observation_revision FOR EACH ROW EXECUTE FUNCTION reject_published_mutation();
  `.execute(db);
  await sql`INSERT INTO published_specification(organization_id,season,kind,version,document)
    SELECT DISTINCT organization_id,season,'match',specification_version,${JSON.stringify(requirements)}::jsonb FROM event
    WHERE specification_version=${requirements.version}`.execute(db);
  for (const table of ["published_specification", "observation_revision"]) {
    await sql`ALTER TABLE ${sql.id(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.id(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`CREATE POLICY tenant_isolation ON ${sql.id(table)} USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid)`.execute(
      db,
    );
    await sql`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN GRANT SELECT,INSERT ON ${sql.id(table)} TO ai_scouting_backend; END IF; END $$`.execute(
      db,
    );
  }
}
export async function down() {
  throw Error("Published history requires a forward migration");
}
