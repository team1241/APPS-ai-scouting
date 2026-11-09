import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE telegram_connect (
      organization_id uuid NOT NULL,
      member_id uuid NOT NULL,
      token_hash text PRIMARY KEY,
      clerk_user_id text NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
      used_at timestamptz,
      used_by text,
      FOREIGN KEY (organization_id, member_id) REFERENCES member(organization_id, id)
    );
    ALTER TABLE telegram_connect ENABLE ROW LEVEL SECURITY;
    ALTER TABLE telegram_connect FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON telegram_connect USING (
      organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    );
    CREATE TABLE telegram_active_team (
      external_id text PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE
    );
    ALTER TABLE telegram_active_team ENABLE ROW LEVEL SECURITY;
    ALTER TABLE telegram_active_team FORCE ROW LEVEL SECURITY;
    CREATE POLICY sender_only ON telegram_active_team USING (
      external_id = nullif(current_setting('app.telegram_user_id', true), '')
    );
    CREATE TABLE telegram_message_route (
      update_id text NOT NULL,
      external_id text NOT NULL,
      organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE
    );
    ALTER TABLE telegram_message_route ADD PRIMARY KEY (external_id, update_id);
    ALTER TABLE telegram_message_route ENABLE ROW LEVEL SECURITY;
    ALTER TABLE telegram_message_route FORCE ROW LEVEL SECURITY;
    CREATE POLICY sender_only ON telegram_message_route USING (
      external_id = nullif(current_setting('app.telegram_user_id', true), '')
    );
    -- Discovery returns IDs only. Every subsequent data access uses tenant RLS.
    -- As with operator functions, migration owner must have BYPASSRLS.
    CREATE FUNCTION scouting_organization_ids() RETURNS SETOF uuid
      LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
      AS 'SELECT id FROM organization ORDER BY id';
    REVOKE ALL ON FUNCTION scouting_organization_ids() FROM PUBLIC;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT EXECUTE ON FUNCTION scouting_organization_ids() TO ai_scouting_backend;
        GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_connect, telegram_active_team TO ai_scouting_backend;
        GRANT SELECT, INSERT ON telegram_message_route TO ai_scouting_backend;
        GRANT DELETE ON channel_identity TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}
export async function down(db: Kysely<any>) {
  await sql`DROP FUNCTION scouting_organization_ids(); DROP TABLE telegram_message_route; DROP TABLE telegram_active_team; DROP TABLE telegram_connect;`.execute(
    db,
  );
}
