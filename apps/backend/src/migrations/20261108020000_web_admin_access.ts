import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE web_admin_access (
      organization_id uuid NOT NULL,
      member_id uuid NOT NULL,
      clerk_user_id text CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]+$'),
      approved_by uuid NOT NULL,
      policy_version text NOT NULL DEFAULT 'adult-admin-v1',
      approved_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, member_id),
      UNIQUE (organization_id, clerk_user_id),
      FOREIGN KEY (organization_id, member_id) REFERENCES member(organization_id, id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id, approved_by) REFERENCES member(organization_id, id)
    );
    CREATE INDEX web_admin_subject ON web_admin_access(clerk_user_id);
    ALTER TABLE web_admin_access ENABLE ROW LEVEL SECURITY;
    ALTER TABLE web_admin_access FORCE ROW LEVEL SECURITY;
    CREATE POLICY subject_access ON web_admin_access FOR SELECT USING (
      clerk_user_id = nullif(current_setting('app.clerk_user_id', true), '')
    );
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT SELECT ON web_admin_access TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("web_admin_access").execute();
}
