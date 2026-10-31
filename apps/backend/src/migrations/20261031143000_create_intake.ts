import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE organization (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK (length(trim(name)) > 0),
      frc_team_number integer NOT NULL CHECK (frc_team_number > 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE member (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organization(id),
      name text NOT NULL CHECK (length(trim(name)) > 0),
      role text NOT NULL DEFAULT 'scout' CHECK (role IN ('scout', 'strategist', 'admin')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id, id)
    );
    CREATE TABLE channel_identity (
      organization_id uuid NOT NULL,
      channel text NOT NULL CHECK (length(trim(channel)) > 0),
      external_id text NOT NULL CHECK (length(trim(external_id)) > 0),
      member_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, channel, external_id),
      FOREIGN KEY (organization_id, member_id) REFERENCES member(organization_id, id)
    );
    CREATE INDEX channel_identity_member_idx ON channel_identity(organization_id, member_id);
    CREATE TABLE raw_entry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      member_id uuid NOT NULL,
      channel text NOT NULL CHECK (length(trim(channel)) > 0),
      external_update_id text NOT NULL CHECK (length(trim(external_update_id)) > 0),
      text text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'done', 'needs_review', 'failed')),
      follow_up_message_id text,
      UNIQUE (organization_id, channel, external_update_id),
      FOREIGN KEY (organization_id, member_id) REFERENCES member(organization_id, id)
    );
    CREATE INDEX raw_entry_queue_idx ON raw_entry(organization_id, status, received_at);
    CREATE INDEX raw_entry_member_idx ON raw_entry(organization_id, member_id);
  `.execute(db);

  for (const table of ["organization", "member", "channel_identity", "raw_entry"]) {
    const tenantColumn = table === "organization" ? "id" : "organization_id";
    await sql`ALTER TABLE ${sql.id(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.id(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation ON ${sql.id(table)}
      USING (${sql.id(tenantColumn)} = nullif(current_setting('app.organization_id', true), '')::uuid)
      WITH CHECK (${sql.id(tenantColumn)} = nullif(current_setting('app.organization_id', true), '')::uuid)
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ["raw_entry", "channel_identity", "member", "organization"]) {
    await db.schema.dropTable(table).execute();
  }
}
