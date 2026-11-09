import { type Kysely, sql } from "kysely";

// Platform operators review public access applications and provision teams.
// The runtime role reads only through RLS and changes state only through the
// SECURITY DEFINER functions below, which check the operator and status rules.
// Function owners must bypass RLS (the migration/owner role), as the operator
// setup commands already require.
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE platform_operator (
      clerk_user_id text PRIMARY KEY CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]+$'),
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE platform_operator ENABLE ROW LEVEL SECURITY;
    ALTER TABLE platform_operator FORCE ROW LEVEL SECURITY;
    CREATE POLICY operator_self ON platform_operator FOR SELECT USING (
      clerk_user_id = nullif(current_setting('app.clerk_user_id', true), '')
    );

    ALTER TABLE access_application
      ADD COLUMN reviewed_by text CHECK (reviewed_by ~ '^user_[A-Za-z0-9]+$'),
      ADD COLUMN reviewed_at timestamptz,
      ADD COLUMN organization_id uuid REFERENCES organization(id),
      ADD COLUMN member_id uuid,
      ADD COLUMN invitation_id text,
      ADD COLUMN invited_at timestamptz,
      ADD COLUMN claimed_at timestamptz,
      ADD CONSTRAINT access_application_review_state CHECK (
        (status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status = 'rejected' AND reviewed_at IS NOT NULL AND organization_id IS NULL)
        OR (status = 'approved' AND reviewed_at IS NOT NULL
            AND organization_id IS NOT NULL AND member_id IS NOT NULL)
      ),
      ADD CONSTRAINT access_application_member
        FOREIGN KEY (organization_id, member_id) REFERENCES member(organization_id, id);
    CREATE INDEX access_application_team ON access_application (team_number);
    CREATE POLICY operator_review ON access_application FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM platform_operator
        WHERE clerk_user_id = nullif(current_setting('app.clerk_user_id', true), '')
      )
    );

    -- Public submission. A retry with the same ID returns the same receipt.
    -- Any earlier application or existing organization for the team blocks it.
    CREATE FUNCTION submit_access_application(
      p_id uuid, p_name text, p_email text, p_team integer, p_role text, p_adult boolean
    ) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('access_application_team'), p_team);
      IF EXISTS (SELECT 1 FROM access_application WHERE id = p_id) THEN
        RETURN 'received';
      END IF;
      IF EXISTS (SELECT 1 FROM access_application WHERE team_number = p_team)
        OR EXISTS (SELECT 1 FROM organization WHERE frc_team_number = p_team) THEN
        RETURN 'team_exists';
      END IF;
      INSERT INTO access_application (id, name, email, team_number, team_role, adult_attested)
        VALUES (p_id, p_name, p_email, p_team, p_role, p_adult);
      RETURN 'received';
    END $fn$;

    -- Approval provisions the organization, its first admin member and the
    -- adult web-admin approval in one transaction. Linking happens on claim.
    CREATE FUNCTION approve_access_application(
      p_id uuid, p_operator text, p_organization_name text
    ) RETURNS TABLE (outcome text, provisioned_organization uuid, provisioned_member uuid)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      app access_application;
      new_org uuid := gen_random_uuid();
      new_member uuid;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator o WHERE o.clerk_user_id = p_operator) THEN
        RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid; RETURN;
      END IF;
      IF p_organization_name IS NULL OR length(trim(p_organization_name)) NOT BETWEEN 1 AND 120 THEN
        RETURN QUERY SELECT 'invalid_name', NULL::uuid, NULL::uuid; RETURN;
      END IF;
      SELECT * INTO app FROM access_application a WHERE a.id = p_id FOR UPDATE;
      IF NOT FOUND OR app.status <> 'pending' THEN
        RETURN QUERY SELECT 'not_pending', NULL::uuid, NULL::uuid; RETURN;
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('access_application_team'), app.team_number);
      IF EXISTS (SELECT 1 FROM organization o WHERE o.frc_team_number = app.team_number) THEN
        RETURN QUERY SELECT 'team_exists', NULL::uuid, NULL::uuid; RETURN;
      END IF;
      PERFORM set_config('app.organization_id', new_org::text, true);
      INSERT INTO organization (id, name, frc_team_number)
        VALUES (new_org, trim(p_organization_name), app.team_number);
      INSERT INTO member (organization_id, name, role)
        VALUES (new_org, app.name, 'admin') RETURNING id INTO new_member;
      INSERT INTO web_admin_access (organization_id, member_id, approved_by, policy_version)
        VALUES (new_org, new_member, new_member, 'operator-approved-v1');
      UPDATE access_application a SET status = 'approved', reviewed_by = p_operator,
        reviewed_at = now(), organization_id = new_org, member_id = new_member
        WHERE a.id = p_id;
      RETURN QUERY SELECT 'approved', new_org, new_member;
    END $fn$;

    CREATE FUNCTION reject_access_application(p_id uuid, p_operator text)
    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator WHERE clerk_user_id = p_operator) THEN
        RETURN 'forbidden';
      END IF;
      UPDATE access_application SET status = 'rejected', reviewed_by = p_operator,
        reviewed_at = now()
        WHERE id = p_id AND status = 'pending';
      RETURN CASE WHEN FOUND THEN 'rejected' ELSE 'not_pending' END;
    END $fn$;

    CREATE FUNCTION record_access_invitation(p_id uuid, p_operator text, p_invitation text)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator WHERE clerk_user_id = p_operator) THEN
        RETURN false;
      END IF;
      UPDATE access_application SET invitation_id = p_invitation, invited_at = now()
        WHERE id = p_id AND status = 'approved' AND claimed_at IS NULL;
      RETURN FOUND;
    END $fn$;

    -- Called with the application ID from Clerk public metadata (set only by
    -- this backend on the invitation) and the account's verified emails.
    CREATE FUNCTION claim_access_application(p_id uuid, p_subject text, p_emails text[])
    RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      app access_application;
    BEGIN
      IF p_subject IS NULL OR p_subject !~ '^user_[A-Za-z0-9]+$' THEN RETURN NULL; END IF;
      SELECT * INTO app FROM access_application WHERE id = p_id FOR UPDATE;
      IF NOT FOUND OR app.status <> 'approved' OR NOT (app.email = ANY (p_emails)) THEN
        RETURN NULL;
      END IF;
      PERFORM set_config('app.organization_id', app.organization_id::text, true);
      IF NOT EXISTS (
        SELECT 1 FROM member WHERE organization_id = app.organization_id
          AND id = app.member_id AND role = 'admin'
      ) THEN
        RETURN NULL;
      END IF;
      UPDATE web_admin_access SET clerk_user_id = p_subject
        WHERE organization_id = app.organization_id AND member_id = app.member_id
          AND (clerk_user_id IS NULL OR clerk_user_id = p_subject);
      IF NOT FOUND THEN RETURN NULL; END IF;
      UPDATE access_application SET claimed_at = coalesce(claimed_at, now()) WHERE id = p_id;
      RETURN app.organization_id;
    END $fn$;

    REVOKE ALL ON FUNCTION
      submit_access_application(uuid, text, text, integer, text, boolean),
      approve_access_application(uuid, text, text),
      reject_access_application(uuid, text),
      record_access_invitation(uuid, text, text),
      claim_access_application(uuid, text, text[])
      FROM PUBLIC;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        -- Submissions go through submit_access_application so the team rule applies.
        REVOKE INSERT ON access_application FROM ai_scouting_backend;
        GRANT SELECT ON platform_operator TO ai_scouting_backend;
        GRANT SELECT ON access_application TO ai_scouting_backend;
        GRANT EXECUTE ON FUNCTION
          submit_access_application(uuid, text, text, integer, text, boolean),
          approve_access_application(uuid, text, text),
          reject_access_application(uuid, text),
          record_access_invitation(uuid, text, text),
          claim_access_application(uuid, text, text[])
          TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP FUNCTION claim_access_application(uuid, text, text[]);
    DROP FUNCTION record_access_invitation(uuid, text, text);
    DROP FUNCTION reject_access_application(uuid, text);
    DROP FUNCTION approve_access_application(uuid, text, text);
    DROP FUNCTION submit_access_application(uuid, text, text, integer, text, boolean);
    DROP POLICY operator_review ON access_application;
    DROP INDEX access_application_team;
    ALTER TABLE access_application
      DROP CONSTRAINT access_application_member,
      DROP CONSTRAINT access_application_review_state,
      DROP COLUMN claimed_at, DROP COLUMN invited_at, DROP COLUMN invitation_id,
      DROP COLUMN member_id, DROP COLUMN organization_id,
      DROP COLUMN reviewed_at, DROP COLUMN reviewed_by;
    DROP TABLE platform_operator;
  `.execute(db);
}
