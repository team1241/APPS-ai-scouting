import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE access_application (
      id uuid PRIMARY KEY,
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(trim(email))),
      team_number integer NOT NULL CHECK (team_number BETWEEN 1 AND 99999),
      team_role text NOT NULL CHECK (team_role IN ('mentor', 'lead_mentor', 'teacher', 'other')),
      adult_attested boolean NOT NULL CHECK (adult_attested),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX access_application_pending ON access_application (email, team_number)
      WHERE status = 'pending';
    CREATE INDEX access_application_review ON access_application (status, created_at);
    ALTER TABLE access_application ENABLE ROW LEVEL SECURITY;
    ALTER TABLE access_application FORCE ROW LEVEL SECURITY;
    CREATE POLICY submit_application ON access_application FOR INSERT
      WITH CHECK (status = 'pending' AND adult_attested);
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT INSERT (id, name, email, team_number, team_role, adult_attested)
          ON access_application TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("access_application").execute();
}
