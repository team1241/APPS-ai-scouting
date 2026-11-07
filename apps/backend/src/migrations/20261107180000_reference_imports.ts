import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE reference_sync (
      organization_id uuid NOT NULL, event_id uuid NOT NULL, source text NOT NULL CHECK(source IN ('frc_events','tba')),
      attempted_at timestamptz NOT NULL DEFAULT now(), succeeded_at timestamptz, status text NOT NULL CHECK(status IN ('ok','failed','partial')),
      complete boolean NOT NULL DEFAULT false, error text,
      PRIMARY KEY(organization_id,event_id,source), FOREIGN KEY(organization_id,event_id) REFERENCES event(organization_id,id) ON DELETE CASCADE
    );
    CREATE TABLE event_team (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, event_id uuid NOT NULL,
      team_number integer NOT NULL CHECK(team_number>0), facts jsonb NOT NULL DEFAULT '{}', manual_override jsonb NOT NULL DEFAULT '{}',
      UNIQUE(organization_id,event_id,team_number), FOREIGN KEY(organization_id,event_id) REFERENCES event(organization_id,id) ON DELETE CASCADE
    );
    CREATE TABLE event_match (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, event_id uuid NOT NULL,
      identity text NOT NULL, stage text NOT NULL CHECK(stage IN ('qualification','playoff')),
      round text NOT NULL, set_number integer NOT NULL, match_number integer NOT NULL,
      facts jsonb NOT NULL DEFAULT '{}', manual_override jsonb NOT NULL DEFAULT '{}',
      UNIQUE(organization_id,event_id,identity), UNIQUE(organization_id,id),
      FOREIGN KEY(organization_id,event_id) REFERENCES event(organization_id,id) ON DELETE CASCADE
    );
    CREATE TABLE match_participant (
      organization_id uuid NOT NULL, match_id uuid NOT NULL, source text NOT NULL CHECK(source IN ('frc_events','tba','manual')),
      station text NOT NULL CHECK(station ~ '^(Red|Blue)[123]$'), team_number integer NOT NULL CHECK(team_number>0), surrogate boolean NOT NULL,
      PRIMARY KEY(organization_id,match_id,source,station), UNIQUE(organization_id,match_id,source,team_number),
      FOREIGN KEY(organization_id,match_id) REFERENCES event_match(organization_id,id) ON DELETE CASCADE
    );
  `.execute(db);
  for (const table of ["reference_sync", "event_team", "event_match", "match_participant"]) {
    await sql`ALTER TABLE ${sql.id(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.id(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`CREATE POLICY tenant_isolation ON ${sql.id(table)} USING(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)`.execute(
      db,
    );
    await sql`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON ' || ${sql.lit(table)} || ' TO ai_scouting_backend'; END IF; END $$`.execute(
      db,
    );
  }
}
export async function down(db: Kysely<any>) {
  await sql`DROP TABLE match_participant,event_match,event_team,reference_sync`.execute(db);
}
