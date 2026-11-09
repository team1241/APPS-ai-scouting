import { type Kysely, sql } from "kysely";

// Operators manage other operators from the web app. The runtime still has no
// direct writes; these SECURITY DEFINER functions check the acting operator.
export async function up(db: Kysely<any>) {
  await sql`
    ALTER TABLE platform_operator
      ADD COLUMN added_by text CHECK (added_by ~ '^user_[A-Za-z0-9]+$');

    CREATE FUNCTION list_platform_operators(p_actor text)
    RETURNS TABLE (clerk_user_id text, name text, created_at timestamptz, added_by_name text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator o WHERE o.clerk_user_id = p_actor) THEN
        RETURN;
      END IF;
      RETURN QUERY
        SELECT o.clerk_user_id, o.name, o.created_at, a.name
        FROM platform_operator o
        LEFT JOIN platform_operator a ON a.clerk_user_id = o.added_by
        ORDER BY o.created_at, o.clerk_user_id;
    END $fn$;

    CREATE FUNCTION add_platform_operator(p_actor text, p_subject text, p_name text)
    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator WHERE clerk_user_id = p_actor) THEN
        RETURN 'forbidden';
      END IF;
      IF p_subject IS NULL OR p_subject !~ '^user_[A-Za-z0-9]+$'
        OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 THEN
        RETURN 'invalid';
      END IF;
      INSERT INTO platform_operator (clerk_user_id, name, added_by)
        VALUES (p_subject, trim(p_name), p_actor)
        ON CONFLICT (clerk_user_id) DO NOTHING;
      RETURN CASE WHEN FOUND THEN 'added' ELSE 'exists' END;
    END $fn$;

    -- An operator cannot remove themselves, so at least one always remains.
    CREATE FUNCTION remove_platform_operator(p_actor text, p_subject text)
    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator WHERE clerk_user_id = p_actor) THEN
        RETURN 'forbidden';
      END IF;
      IF p_subject = p_actor THEN RETURN 'self'; END IF;
      DELETE FROM platform_operator WHERE clerk_user_id = p_subject;
      RETURN CASE WHEN FOUND THEN 'removed' ELSE 'not_found' END;
    END $fn$;

    REVOKE ALL ON FUNCTION
      list_platform_operators(text),
      add_platform_operator(text, text, text),
      remove_platform_operator(text, text)
      FROM PUBLIC;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT EXECUTE ON FUNCTION
          list_platform_operators(text),
          add_platform_operator(text, text, text),
          remove_platform_operator(text, text)
          TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP FUNCTION remove_platform_operator(text, text);
    DROP FUNCTION add_platform_operator(text, text, text);
    DROP FUNCTION list_platform_operators(text);
    ALTER TABLE platform_operator DROP COLUMN added_by;
  `.execute(db);
}
