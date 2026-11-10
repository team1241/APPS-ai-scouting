import { type Kysely, sql } from "kysely";

// Scouting specification drafts, publication metadata and pit/general event assignment (#46).
export async function up(db: Kysely<any>) {
  await sql`
    -- Publications stay immutable. New nullable columns describe web publications only.
    ALTER TABLE published_specification
      ADD COLUMN name text CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 80),
      ADD COLUMN published_by uuid,
      ADD COLUMN source_draft_id uuid;

    CREATE TABLE specification_draft (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      season integer NOT NULL CHECK (season BETWEEN 1992 AND 2100),
      kind text NOT NULL CHECK (kind IN ('match','pit','general')),
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
      -- Draft content may be incomplete. Only publication requires a valid contract.
      document jsonb NOT NULL,
      -- Optimistic concurrency token. Every save increments it.
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      source_season integer,
      source_version text,
      -- Set once by publication. A published draft is locked.
      published_version text,
      published_at timestamptz,
      created_by uuid,
      updated_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id, id),
      CHECK ((published_version IS NULL) = (published_at IS NULL)),
      FOREIGN KEY (organization_id, created_by) REFERENCES member(organization_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (organization_id, updated_by) REFERENCES member(organization_id, id) ON DELETE SET NULL (updated_by),
      FOREIGN KEY (organization_id, season, kind, published_version)
        REFERENCES published_specification(organization_id, season, kind, version)
    );
    CREATE INDEX specification_draft_open ON specification_draft(organization_id, season, kind)
      WHERE published_version IS NULL;

    -- Match assignment stays on event.specification_version. Pit and general use this table.
    CREATE TABLE event_specification_assignment (
      organization_id uuid NOT NULL,
      event_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('pit','general')),
      season integer NOT NULL,
      version text NOT NULL,
      assigned_by uuid,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, event_id, kind),
      FOREIGN KEY (organization_id, event_id) REFERENCES event(organization_id, id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id, season, kind, version)
        REFERENCES published_specification(organization_id, season, kind, version),
      FOREIGN KEY (organization_id, assigned_by) REFERENCES member(organization_id, id) ON DELETE SET NULL (assigned_by)
    );
  `.execute(db);
  for (const table of ["specification_draft", "event_specification_assignment"]) {
    await sql`ALTER TABLE ${sql.id(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.id(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`CREATE POLICY tenant_isolation ON ${sql.id(table)} USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)`.execute(
      db,
    );
    await sql`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON ${sql.id(table)} TO ai_scouting_backend; END IF; END $$`.execute(
      db,
    );
  }
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("event_specification_assignment").execute();
  await db.schema.dropTable("specification_draft").execute();
  await sql`ALTER TABLE published_specification DROP COLUMN source_draft_id, DROP COLUMN published_by, DROP COLUMN name`.execute(
    db,
  );
}
