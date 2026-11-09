import { type Kysely, sql } from "kysely";

// Operators revoke any team's API key and remove any team administrator (#41).
// Like the directory, these are SECURITY DEFINER functions that recheck
// platform_operator; the runtime gets no table privileges.
//
// Removing an administrator demotes the member to scout and deletes their web
// approval. The member row stays, so their scouting history and Telegram
// identity are kept. Their pending admin invitations are cancelled.
//
// operator_team_action records which operator did what, in which team.
export async function up(db: Kysely<any>) {
  await sql`
    ALTER TABLE api_key
      ADD COLUMN revoked_by_operator text CHECK (revoked_by_operator ~ '^user_[A-Za-z0-9]+$');

    CREATE TABLE operator_team_action (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      operator text NOT NULL CHECK (operator ~ '^user_[A-Za-z0-9]+$'),
      action text NOT NULL CHECK (action IN ('revoke_api_key', 'remove_admin')),
      target_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX operator_team_action_team ON operator_team_action (organization_id, created_at);
    ALTER TABLE operator_team_action ENABLE ROW LEVEL SECURITY;
    ALTER TABLE operator_team_action FORCE ROW LEVEL SECURITY;

    -- Step one of a revoke: locks an active key until the transaction ends and
    -- returns its provider ID. The caller revokes it with the provider, then
    -- calls complete_operator_api_key_revoke in the same transaction.
    CREATE FUNCTION lock_operator_api_key(p_actor text, p_org uuid, p_id uuid)
    RETURNS TABLE (outcome text, provider_key_id text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      stored api_key;
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN
        RETURN QUERY SELECT 'forbidden', NULL::text; RETURN;
      END IF;
      SELECT * INTO stored FROM api_key k
        WHERE k.organization_id = p_org AND k.id = p_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found', NULL::text; RETURN;
      END IF;
      IF stored.revoked_at IS NOT NULL THEN
        RETURN QUERY SELECT 'already_revoked', NULL::text; RETURN;
      END IF;
      RETURN QUERY SELECT 'locked', stored.provider_key_id;
    END $fn$;

    CREATE FUNCTION complete_operator_api_key_revoke(p_actor text, p_org uuid, p_id uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN RETURN false; END IF;
      UPDATE api_key SET revoked_at = now(), revoked_by = NULL, revoked_by_operator = p_actor,
          secret_ciphertext = NULL
        WHERE organization_id = p_org AND id = p_id AND revoked_at IS NULL;
      IF NOT FOUND THEN RETURN false; END IF;
      INSERT INTO operator_team_action (organization_id, operator, action, target_id)
        VALUES (p_org, p_actor, 'revoke_api_key', p_id);
      RETURN true;
    END $fn$;

    -- Returns the Clerk IDs of cancelled invitations, for the caller to revoke.
    CREATE FUNCTION remove_operator_team_admin(p_actor text, p_org uuid, p_member uuid)
    RETURNS TABLE (outcome text, clerk_invitation_ids text[])
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      cancelled text[];
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN
        RETURN QUERY SELECT 'forbidden', NULL::text[]; RETURN;
      END IF;
      PERFORM set_config('app.organization_id', p_org::text, true);
      -- Serializes with invitation changes in the team. Taken before the row
      -- lock, in the same order as the invitation functions. NO KEY UPDATE
      -- still lets concurrent inserts reference the member.
      PERFORM pg_advisory_xact_lock(hashtext('team_admin_invitation'), hashtext(p_org::text));
      PERFORM 1 FROM member m
        WHERE m.organization_id = p_org AND m.id = p_member AND m.role = 'admin'
        FOR NO KEY UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found', NULL::text[]; RETURN;
      END IF;
      DELETE FROM web_admin_access WHERE organization_id = p_org AND member_id = p_member;
      UPDATE member SET role = 'scout' WHERE organization_id = p_org AND id = p_member;
      WITH closed AS (
        UPDATE team_admin_invitation i SET status = 'cancelled', email = NULL, closed_at = now()
          WHERE i.organization_id = p_org AND i.invited_by_member = p_member
            AND i.status = 'pending'
          RETURNING i.clerk_invitation_id
      )
      SELECT coalesce(array_agg(c.clerk_invitation_id) FILTER (WHERE c.clerk_invitation_id IS NOT NULL),
          ARRAY[]::text[])
        INTO cancelled FROM closed c;
      INSERT INTO operator_team_action (organization_id, operator, action, target_id)
        VALUES (p_org, p_actor, 'remove_admin', p_member);
      RETURN QUERY SELECT 'removed', cancelled;
    END $fn$;

    REVOKE ALL ON FUNCTION
      lock_operator_api_key(text, uuid, uuid),
      complete_operator_api_key_revoke(text, uuid, uuid),
      remove_operator_team_admin(text, uuid, uuid)
      FROM PUBLIC;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT EXECUTE ON FUNCTION
          lock_operator_api_key(text, uuid, uuid),
          complete_operator_api_key_revoke(text, uuid, uuid),
          remove_operator_team_admin(text, uuid, uuid)
          TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP FUNCTION remove_operator_team_admin(text, uuid, uuid);
    DROP FUNCTION complete_operator_api_key_revoke(text, uuid, uuid);
    DROP FUNCTION lock_operator_api_key(text, uuid, uuid);
    DROP TABLE operator_team_action;
    ALTER TABLE api_key DROP COLUMN revoked_by_operator;
  `.execute(db);
}
