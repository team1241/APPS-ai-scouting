import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE event (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organization(id),
      name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
      season integer NOT NULL CHECK(season BETWEEN 1992 AND 2100),
      type text NOT NULL CHECK(type IN ('official','offseason','practice')),
      source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','frc_events','tba')),
      start_date date NOT NULL, end_date date NOT NULL CHECK(end_date >= start_date),
      timezone text NOT NULL,
      attending boolean NOT NULL DEFAULT false,
      archived boolean NOT NULL DEFAULT false,
      specification_version text NOT NULL,
      validation_mode text NOT NULL DEFAULT 'warn' CHECK(validation_mode IN ('off','warn','strict')),
      frc_event_code text, tba_event_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,id), UNIQUE(organization_id,id,archived)
    );
    CREATE TABLE organization_event_setting (
      organization_id uuid PRIMARY KEY REFERENCES organization(id),
      active_event_id uuid,
      active_event_archived boolean NOT NULL DEFAULT false CHECK(active_event_archived = false),
      FOREIGN KEY(organization_id,active_event_id,active_event_archived)
        REFERENCES event(organization_id,id,archived)
    );
    CREATE TABLE event_command (
      organization_id uuid NOT NULL REFERENCES organization(id),
      source_update_id text NOT NULL,
      result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(organization_id,source_update_id)
    );
    ALTER TABLE scouting_session ADD COLUMN event_id uuid,
      ADD CONSTRAINT scouting_session_event_fk FOREIGN KEY(organization_id,event_id) REFERENCES event(organization_id,id);
    CREATE INDEX scouting_session_event_idx ON scouting_session(organization_id,event_id);
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT SELECT,INSERT,UPDATE ON event,organization_event_setting TO ai_scouting_backend;
        GRANT SELECT,INSERT ON event_command TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
  for (const table of ["event", "organization_event_setting", "event_command"]) {
    await sql`ALTER TABLE ${sql.id(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.id(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`CREATE POLICY tenant_isolation ON ${sql.id(table)}
      USING(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)
      WITH CHECK(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)`.execute(
      db,
    );
  }
}
export async function down(db: Kysely<any>) {
  await sql`ALTER TABLE scouting_session DROP CONSTRAINT scouting_session_event_fk, DROP COLUMN event_id;
    DROP TABLE event_command; DROP TABLE organization_event_setting; DROP TABLE event;`.execute(db);
}
