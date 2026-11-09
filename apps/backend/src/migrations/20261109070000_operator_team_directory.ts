import { type Kysely, sql } from "kysely";

// Operators see every registered team, its admins and its API keys (#41). This
// is a read-only, operator-only capability across teams. Operators get no team
// membership and no table privileges. The runtime reads only through these
// SECURITY DEFINER functions, which recheck platform_operator on every call.
//
// No function returns an email address or a Clerk account ID. Key secrets come
// back only from reveal_operator_api_key, for one active key at a time.
export async function up(db: Kysely<any>) {
  await sql`
    CREATE FUNCTION is_platform_operator(p_actor text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
      SELECT coalesce(p_actor ~ '^user_[A-Za-z0-9]+$', false)
        AND EXISTS (SELECT 1 FROM platform_operator WHERE clerk_user_id = p_actor)
    $fn$;

    -- One page of teams. p_search matches the start of the team number or any
    -- part of the team name. total_count is the match count before paging.
    CREATE FUNCTION list_operator_teams(p_actor text, p_search text, p_limit integer, p_offset integer)
    RETURNS TABLE (id uuid, name text, team_number integer, created_at timestamptz,
      admin_count integer, web_admin_count integer, pending_invitation_count integer,
      active_key_count integer, total_count integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      wanted text := nullif(trim(coalesce(p_search, '')), '');
      pattern text;
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN RETURN; END IF;
      IF wanted IS NOT NULL THEN
        pattern := replace(replace(replace(left(wanted, 120), '\\', '\\\\'), '%', '\\%'), '_', '\\_');
      END IF;
      RETURN QUERY
        WITH matched AS (
          SELECT o.id, o.name, o.frc_team_number, o.created_at
          FROM organization o
          WHERE pattern IS NULL
            OR o.frc_team_number::text LIKE pattern || '%'
            OR o.name ILIKE '%' || pattern || '%'
        )
        SELECT m.id, m.name, m.frc_team_number, m.created_at,
          (SELECT count(*)::integer FROM member a
            WHERE a.organization_id = m.id AND a.role = 'admin'),
          (SELECT count(*)::integer FROM web_admin_access w
            JOIN member a ON a.organization_id = w.organization_id AND a.id = w.member_id
            WHERE w.organization_id = m.id AND a.role = 'admin' AND w.clerk_user_id IS NOT NULL),
          (SELECT count(*)::integer FROM team_admin_invitation i
            WHERE i.organization_id = m.id AND i.status = 'pending' AND i.expires_at > now()),
          (SELECT count(*)::integer FROM api_key k
            WHERE k.organization_id = m.id AND k.revoked_at IS NULL),
          (count(*) OVER ())::integer
        FROM matched m
        ORDER BY m.frc_team_number, m.id
        LIMIT least(greatest(coalesce(p_limit, 25), 1), 50)
        OFFSET greatest(coalesce(p_offset, 0), 0);
    END $fn$;

    CREATE FUNCTION operator_team(p_actor text, p_org uuid)
    RETURNS TABLE (id uuid, name text, team_number integer, created_at timestamptz)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN RETURN; END IF;
      RETURN QUERY SELECT o.id, o.name, o.frc_team_number, o.created_at
        FROM organization o WHERE o.id = p_org;
    END $fn$;

    -- Every admin member. web_access is 'none' for a backend admin with no
    -- adult web approval, 'approved' when approved but not yet signed in, and
    -- 'linked' when approved and linked to an account.
    CREATE FUNCTION list_operator_team_admins(p_actor text, p_org uuid)
    RETURNS TABLE (member_id uuid, name text, added_at timestamptz, web_access text,
      approved_at timestamptz)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN RETURN; END IF;
      RETURN QUERY
        SELECT m.id, m.name, m.created_at,
          CASE WHEN w.member_id IS NULL THEN 'none'
            WHEN w.clerk_user_id IS NULL THEN 'approved'
            ELSE 'linked' END,
          w.approved_at
        FROM member m
        LEFT JOIN web_admin_access w ON w.organization_id = m.organization_id AND w.member_id = m.id
        WHERE m.organization_id = p_org AND m.role = 'admin'
        ORDER BY m.created_at, m.id;
    END $fn$;

    -- Open invitations, without the invitee email. Read-only: expired rows are
    -- left for the team's own list to close.
    CREATE FUNCTION list_operator_team_admin_invitations(p_actor text, p_org uuid)
    RETURNS TABLE (id uuid, name text, existing_account boolean, invited_by_name text,
      created_at timestamptz, expires_at timestamptz, sent boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN RETURN; END IF;
      RETURN QUERY
        SELECT i.id, i.name, i.target_clerk_user_id IS NOT NULL, m.name, i.created_at,
          i.expires_at, i.target_clerk_user_id IS NOT NULL OR i.clerk_invitation_id IS NOT NULL
        FROM team_admin_invitation i
        LEFT JOIN member m ON m.organization_id = i.organization_id AND m.id = i.invited_by_member
        WHERE i.organization_id = p_org AND i.status = 'pending' AND i.expires_at > now()
        ORDER BY i.created_at, i.id;
    END $fn$;

    -- Key metadata only. Active keys first, then the 50 newest revoked keys.
    CREATE FUNCTION list_operator_api_keys(p_actor text, p_org uuid)
    RETURNS TABLE (id uuid, name text, start text, rate_limit_per_minute integer,
      created_at timestamptz, revoked_at timestamptz)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN RETURN; END IF;
      RETURN QUERY
        (SELECT k.id, k.name, k.start, k.rate_limit_per_minute, k.created_at, k.revoked_at
          FROM api_key k WHERE k.organization_id = p_org AND k.revoked_at IS NULL
          ORDER BY k.created_at DESC, k.id)
        UNION ALL
        (SELECT k.id, k.name, k.start, k.rate_limit_per_minute, k.created_at, k.revoked_at
          FROM api_key k WHERE k.organization_id = p_org AND k.revoked_at IS NOT NULL
          ORDER BY k.revoked_at DESC, k.id LIMIT 50);
    END $fn$;

    -- The stored ciphertext of one active key in the named team. Revoked keys
    -- have no ciphertext, so they return 'revoked' and nothing to decrypt.
    CREATE FUNCTION reveal_operator_api_key(p_actor text, p_org uuid, p_id uuid)
    RETURNS TABLE (outcome text, secret_ciphertext text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      stored api_key;
    BEGIN
      IF NOT is_platform_operator(p_actor) THEN
        RETURN QUERY SELECT 'forbidden', NULL::text; RETURN;
      END IF;
      SELECT * INTO stored FROM api_key k WHERE k.organization_id = p_org AND k.id = p_id;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found', NULL::text; RETURN;
      END IF;
      IF stored.revoked_at IS NOT NULL OR stored.secret_ciphertext IS NULL THEN
        RETURN QUERY SELECT 'revoked', NULL::text; RETURN;
      END IF;
      RETURN QUERY SELECT 'revealed', stored.secret_ciphertext;
    END $fn$;

    REVOKE ALL ON FUNCTION
      is_platform_operator(text),
      list_operator_teams(text, text, integer, integer),
      operator_team(text, uuid),
      list_operator_team_admins(text, uuid),
      list_operator_team_admin_invitations(text, uuid),
      list_operator_api_keys(text, uuid),
      reveal_operator_api_key(text, uuid, uuid)
      FROM PUBLIC;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT EXECUTE ON FUNCTION
          list_operator_teams(text, text, integer, integer),
          operator_team(text, uuid),
          list_operator_team_admins(text, uuid),
          list_operator_team_admin_invitations(text, uuid),
          list_operator_api_keys(text, uuid),
          reveal_operator_api_key(text, uuid, uuid)
          TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP FUNCTION reveal_operator_api_key(text, uuid, uuid);
    DROP FUNCTION list_operator_api_keys(text, uuid);
    DROP FUNCTION list_operator_team_admin_invitations(text, uuid);
    DROP FUNCTION list_operator_team_admins(text, uuid);
    DROP FUNCTION operator_team(text, uuid);
    DROP FUNCTION list_operator_teams(text, text, integer, integer);
    DROP FUNCTION is_platform_operator(text);
  `.execute(db);
}
