import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE api_key (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
      provider_key_id text NOT NULL UNIQUE,
      start text NOT NULL,
      -- AES-256-GCM ciphertext, so admins can view the key again. Cleared on revoke.
      secret_ciphertext text,
      rate_limit_per_minute integer NOT NULL CHECK (rate_limit_per_minute > 0),
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      revoked_by uuid,
      UNIQUE (organization_id, id),
      CHECK ((revoked_at IS NULL) = (secret_ciphertext IS NOT NULL)),
      -- Keys belong to the team. They stay when the creating admin leaves.
      FOREIGN KEY (organization_id, created_by) REFERENCES member(organization_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (organization_id, revoked_by) REFERENCES member(organization_id, id) ON DELETE SET NULL (revoked_by)
    );
    CREATE INDEX api_key_active ON api_key(organization_id) WHERE revoked_at IS NULL;
    ALTER TABLE api_key ENABLE ROW LEVEL SECURITY;
    ALTER TABLE api_key FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON api_key USING (
      organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    );
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT SELECT, INSERT, UPDATE ON api_key TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("api_key").execute();
}
