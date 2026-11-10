import { type Kysely, sql } from "kysely";

// Contract-driven extraction for match, pit and general scouting (#48).
export async function up(db: Kysely<any>) {
  await sql`
    -- Each session pins the publication it was admitted with: season, kind and version.
    ALTER TABLE scouting_session
      ADD COLUMN kind text NOT NULL DEFAULT 'match' CHECK (kind IN ('match','pit','general')),
      ADD COLUMN specification_season integer;
    UPDATE scouting_session s SET specification_season = e.season
      FROM event e WHERE e.organization_id = s.organization_id AND e.id = s.event_id;
    -- Existing rows are not revalidated; every new session must reference a publication.
    ALTER TABLE scouting_session ADD CONSTRAINT scouting_session_publication
      FOREIGN KEY (organization_id, specification_season, kind, specification_version)
      REFERENCES published_specification(organization_id, season, kind, version) NOT VALID;

    -- General notes may have no team. Match and pit observations always have one.
    ALTER TABLE observation_revision ALTER COLUMN team_number DROP NOT NULL;
    ALTER TABLE observation_revision ADD CONSTRAINT observation_revision_team
      CHECK (kind = 'general' OR team_number IS NOT NULL);
    -- Per-question state and inactive values, so consumers can tell unknown, optional and
    -- inactive apart. Empty for observations recorded before #48.
    ALTER TABLE observation_revision ADD COLUMN applicability jsonb NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE intake_rejection DROP CONSTRAINT intake_rejection_reason_check;
    ALTER TABLE intake_rejection ADD CONSTRAINT intake_rejection_reason_check
      CHECK (reason IN ('no_active_event','invalid_event','legacy_session','completed_session','kind_unassigned'));
  `.execute(db);
}

export async function down() {
  throw Error("Published history requires a forward migration");
}
