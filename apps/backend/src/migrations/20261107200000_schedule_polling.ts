import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE schedule_poll (
      organization_id uuid NOT NULL, event_id uuid NOT NULL,
      attempt_id uuid, attempted_at timestamptz, received_at timestamptz,
      status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','fetching','failed','received')),
      source text CHECK(source IN ('frc_events','tba','cached')), error text,
      PRIMARY KEY(organization_id,event_id),
      FOREIGN KEY(organization_id,event_id) REFERENCES event(organization_id,id) ON DELETE CASCADE
    );
    CREATE TABLE schedule_notification (
      organization_id uuid NOT NULL, event_id uuid NOT NULL, telegram_user_id text NOT NULL,
      text text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','uncertain','failed','cancelled')),
      attempt_id uuid, attempted_at timestamptz, sent_at timestamptz,
      next_attempt_at timestamptz NOT NULL DEFAULT now(), error text,
      PRIMARY KEY(organization_id,event_id,telegram_user_id),
      FOREIGN KEY(organization_id,event_id) REFERENCES event(organization_id,id) ON DELETE CASCADE
    );
    CREATE INDEX schedule_notification_pending_idx ON schedule_notification(organization_id,status,next_attempt_at);
  `.execute(db);
  for (const table of ["schedule_poll", "schedule_notification"]) {
    await sql`ALTER TABLE ${sql.id(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.id(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`CREATE POLICY tenant_isolation ON ${sql.id(table)} USING(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)`.execute(
      db,
    );
    await sql`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN EXECUTE 'GRANT SELECT,INSERT,UPDATE ON ' || ${sql.lit(table)} || ' TO ai_scouting_backend'; END IF; END $$`.execute(
      db,
    );
  }
}
export async function down(db: Kysely<any>) {
  await sql`DROP TABLE schedule_notification,schedule_poll`.execute(db);
}
