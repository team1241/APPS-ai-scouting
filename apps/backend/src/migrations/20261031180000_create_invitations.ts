import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE invitation (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organization(id),
      created_by uuid NOT NULL,
      label text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      source_update_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      uses integer NOT NULL DEFAULT 0,
      UNIQUE(organization_id,source_update_id),
      FOREIGN KEY(organization_id,created_by) REFERENCES member(organization_id,id)
    );
    ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
    ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON invitation
      USING(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)
      WITH CHECK(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
  `.execute(db);
}
export async function down(db: Kysely<any>) {
  await db.schema.dropTable("invitation").execute();
}
