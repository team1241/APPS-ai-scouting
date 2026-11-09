import { type Kysely, sql } from "kysely";

// Operators invite people who have no account yet. The invitee becomes an
// operator on first sign-in when a verified email matches an open invitation.
// The email is kept only while the invitation is open.
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE operator_invitation (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email = lower(trim(email)))),
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      invited_by text NOT NULL CHECK (invited_by ~ '^user_[A-Za-z0-9]+$'),
      clerk_invitation_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
      accepted_by text CHECK (accepted_by ~ '^user_[A-Za-z0-9]+$'),
      accepted_at timestamptz,
      revoked_at timestamptz,
      CHECK ((accepted_at IS NULL AND revoked_at IS NULL) = (email IS NOT NULL)),
      CHECK (accepted_at IS NULL OR revoked_at IS NULL)
    );
    CREATE UNIQUE INDEX operator_invitation_open ON operator_invitation (email)
      WHERE email IS NOT NULL;
    ALTER TABLE operator_invitation ENABLE ROW LEVEL SECURITY;
    ALTER TABLE operator_invitation FORCE ROW LEVEL SECURITY;

    CREATE FUNCTION create_operator_invitation(p_actor text, p_email text, p_name text)
    RETURNS TABLE (outcome text, invitation_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      new_id uuid;
      wanted text := lower(trim(p_email));
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator o WHERE o.clerk_user_id = p_actor) THEN
        RETURN QUERY SELECT 'forbidden', NULL::uuid; RETURN;
      END IF;
      IF wanted IS NULL OR wanted !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR length(wanted) > 254
        OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 THEN
        RETURN QUERY SELECT 'invalid', NULL::uuid; RETURN;
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('operator_invitation'), hashtext(wanted));
      -- An expired invitation no longer blocks a new one.
      UPDATE operator_invitation i SET revoked_at = now(), email = NULL
        WHERE i.email = wanted AND i.expires_at <= now();
      IF EXISTS (SELECT 1 FROM operator_invitation i WHERE i.email = wanted) THEN
        RETURN QUERY SELECT 'exists', NULL::uuid; RETURN;
      END IF;
      INSERT INTO operator_invitation (email, name, invited_by)
        VALUES (wanted, trim(p_name), p_actor) RETURNING id INTO new_id;
      RETURN QUERY SELECT 'created', new_id;
    END $fn$;

    -- Records the Clerk invitation and restarts the 7-day window (also on resend).
    CREATE FUNCTION record_operator_invitation(p_actor text, p_id uuid, p_clerk_invitation text)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator WHERE clerk_user_id = p_actor) THEN
        RETURN false;
      END IF;
      UPDATE operator_invitation SET clerk_invitation_id = p_clerk_invitation,
        expires_at = now() + interval '7 days'
        WHERE id = p_id AND email IS NOT NULL;
      RETURN FOUND;
    END $fn$;

    -- Returns what a resend needs: the open invitation's email and current Clerk ID.
    CREATE FUNCTION open_operator_invitation(p_actor text, p_id uuid)
    RETURNS TABLE (email text, clerk_invitation_id text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator o WHERE o.clerk_user_id = p_actor) THEN
        RETURN;
      END IF;
      RETURN QUERY SELECT i.email, i.clerk_invitation_id FROM operator_invitation i
        WHERE i.id = p_id AND i.email IS NOT NULL;
    END $fn$;

    -- Cancels an open invitation and clears its email. Returns the Clerk ID to revoke.
    CREATE FUNCTION revoke_operator_invitation(p_actor text, p_id uuid)
    RETURNS TABLE (outcome text, clerk_invitation_id text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      clerk_id text;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator o WHERE o.clerk_user_id = p_actor) THEN
        RETURN QUERY SELECT 'forbidden', NULL::text; RETURN;
      END IF;
      UPDATE operator_invitation i SET revoked_at = now(), email = NULL
        WHERE i.id = p_id AND i.email IS NOT NULL
        RETURNING i.clerk_invitation_id INTO clerk_id;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found', NULL::text; RETURN;
      END IF;
      RETURN QUERY SELECT 'revoked', clerk_id;
    END $fn$;

    CREATE FUNCTION list_operator_invitations(p_actor text)
    RETURNS TABLE (id uuid, email text, name text, invited_by_name text,
      created_at timestamptz, expires_at timestamptz, sent boolean)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform_operator o WHERE o.clerk_user_id = p_actor) THEN
        RETURN;
      END IF;
      RETURN QUERY
        SELECT i.id, i.email, i.name, o.name, i.created_at, i.expires_at,
          i.clerk_invitation_id IS NOT NULL
        FROM operator_invitation i
        LEFT JOIN platform_operator o ON o.clerk_user_id = i.invited_by
        WHERE i.email IS NOT NULL
        ORDER BY i.created_at, i.id;
    END $fn$;

    -- Called with the invitation ID from server-set Clerk metadata and the
    -- account's verified emails. Adds the operator once; repeats are no-ops.
    CREATE FUNCTION claim_operator_invitation(p_id uuid, p_subject text, p_emails text[])
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      inv operator_invitation;
    BEGIN
      IF p_subject IS NULL OR p_subject !~ '^user_[A-Za-z0-9]+$' THEN RETURN false; END IF;
      SELECT * INTO inv FROM operator_invitation WHERE id = p_id FOR UPDATE;
      IF NOT FOUND THEN RETURN false; END IF;
      IF inv.accepted_by = p_subject THEN RETURN true; END IF;
      IF inv.email IS NULL OR inv.expires_at <= now() OR NOT (inv.email = ANY (p_emails)) THEN
        RETURN false;
      END IF;
      INSERT INTO platform_operator (clerk_user_id, name, added_by)
        VALUES (p_subject, inv.name, inv.invited_by)
        ON CONFLICT (clerk_user_id) DO NOTHING;
      UPDATE operator_invitation SET accepted_by = p_subject, accepted_at = now(), email = NULL
        WHERE id = p_id;
      RETURN true;
    END $fn$;

    REVOKE ALL ON FUNCTION
      create_operator_invitation(text, text, text),
      record_operator_invitation(text, uuid, text),
      open_operator_invitation(text, uuid),
      revoke_operator_invitation(text, uuid),
      list_operator_invitations(text),
      claim_operator_invitation(uuid, text, text[])
      FROM PUBLIC;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT EXECUTE ON FUNCTION
          create_operator_invitation(text, text, text),
          record_operator_invitation(text, uuid, text),
          open_operator_invitation(text, uuid),
          revoke_operator_invitation(text, uuid),
          list_operator_invitations(text),
          claim_operator_invitation(uuid, text, text[])
          TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP FUNCTION claim_operator_invitation(uuid, text, text[]);
    DROP FUNCTION list_operator_invitations(text);
    DROP FUNCTION revoke_operator_invitation(text, uuid);
    DROP FUNCTION open_operator_invitation(text, uuid);
    DROP FUNCTION record_operator_invitation(text, uuid, text);
    DROP FUNCTION create_operator_invitation(text, text, text);
    DROP TABLE operator_invitation;
  `.execute(db);
}
