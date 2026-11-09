import { type Kysely, sql } from "kysely";

// Team admins invite other adults to administer their team (#40).
// Invitations are scoped to one team and record the inviting admin and their
// adult attestation. A pending invitation grants nothing. On acceptance, one
// transaction creates the admin member and the linked web_admin_access row.
//
// Two kinds of invitation:
// - Email: no Clerk account has the email. Clerk sends an invitation whose
//   server-set public metadata names this invitation.
// - Existing account: the email is verified on exactly one Clerk account. The
//   invitation is bound to that account, which accepts it in the app.
// Both kinds also need a verified email that matches the invitation.
//
// The runtime has no table privileges here. All access goes through the
// SECURITY DEFINER functions below, which recheck the acting admin. The email
// is kept only while the invitation is pending.
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE team_admin_invitation (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      email text CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email = lower(trim(email)))),
      target_clerk_user_id text CHECK (target_clerk_user_id ~ '^user_[A-Za-z0-9]+$'),
      invited_by_member uuid NOT NULL,
      invited_by text NOT NULL CHECK (invited_by ~ '^user_[A-Za-z0-9]+$'),
      adult_attested boolean NOT NULL CHECK (adult_attested),
      policy_version text NOT NULL DEFAULT 'admin-invited-v1',
      clerk_invitation_id text,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired', 'superseded')),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
      closed_at timestamptz,
      accepted_by text CHECK (accepted_by ~ '^user_[A-Za-z0-9]+$'),
      accepted_member_id uuid,
      FOREIGN KEY (organization_id, invited_by_member) REFERENCES member(organization_id, id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id, accepted_member_id) REFERENCES member(organization_id, id) ON DELETE SET NULL (accepted_member_id),
      CHECK ((status = 'pending') = (email IS NOT NULL)),
      CHECK ((status = 'pending') = (closed_at IS NULL)),
      CHECK ((status = 'accepted') = (accepted_by IS NOT NULL))
    );
    CREATE UNIQUE INDEX team_admin_invitation_open_email
      ON team_admin_invitation (organization_id, email) WHERE status = 'pending';
    CREATE UNIQUE INDEX team_admin_invitation_open_account
      ON team_admin_invitation (organization_id, target_clerk_user_id)
      WHERE status = 'pending' AND target_clerk_user_id IS NOT NULL;
    CREATE INDEX team_admin_invitation_account
      ON team_admin_invitation (target_clerk_user_id) WHERE status = 'pending';
    ALTER TABLE team_admin_invitation ENABLE ROW LEVEL SECURITY;
    ALTER TABLE team_admin_invitation FORCE ROW LEVEL SECURITY;

    -- The acting account's admin member ID in the team, or NULL. Requires a
    -- linked web_admin_access approval and a current admin role.
    CREATE FUNCTION team_admin_actor(p_actor text, p_org uuid)
    RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
      SELECT w.member_id FROM web_admin_access w
        JOIN member m ON m.organization_id = w.organization_id AND m.id = w.member_id
        WHERE w.organization_id = p_org AND w.clerk_user_id = p_actor AND m.role = 'admin'
          AND p_actor ~ '^user_[A-Za-z0-9]+$'
    $fn$;

    -- Closes pending invitations past their expiry, clearing the email.
    CREATE FUNCTION expire_team_admin_invitations(p_org uuid)
    RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
      UPDATE team_admin_invitation SET status = 'expired', email = NULL, closed_at = now()
        WHERE organization_id = p_org AND status = 'pending' AND expires_at <= now()
    $fn$;

    -- p_target is the Clerk account found by verified email, or NULL when no
    -- account has it. The caller looks it up; the account still has to prove
    -- the email again when it accepts.
    CREATE FUNCTION create_team_admin_invitation(
      p_actor text, p_org uuid, p_email text, p_name text, p_target text, p_adult boolean
    ) RETURNS TABLE (outcome text, invitation_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      actor_member uuid := team_admin_actor(p_actor, p_org);
      wanted text := lower(trim(p_email));
      new_id uuid;
    BEGIN
      IF actor_member IS NULL THEN
        RETURN QUERY SELECT 'forbidden', NULL::uuid; RETURN;
      END IF;
      IF wanted IS NULL OR wanted !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR length(wanted) > 254
        OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120
        OR p_adult IS NOT TRUE
        OR (p_target IS NOT NULL AND p_target !~ '^user_[A-Za-z0-9]+$') THEN
        RETURN QUERY SELECT 'invalid', NULL::uuid; RETURN;
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('team_admin_invitation'), hashtext(p_org::text));
      PERFORM expire_team_admin_invitations(p_org);
      IF p_target IS NOT NULL AND EXISTS (
        SELECT 1 FROM web_admin_access w WHERE w.organization_id = p_org AND w.clerk_user_id = p_target
      ) THEN
        RETURN QUERY SELECT 'already_admin', NULL::uuid; RETURN;
      END IF;
      IF EXISTS (
        SELECT 1 FROM team_admin_invitation i
        WHERE i.organization_id = p_org AND i.status = 'pending'
          AND (i.email = wanted OR (p_target IS NOT NULL AND i.target_clerk_user_id = p_target))
      ) THEN
        RETURN QUERY SELECT 'exists', NULL::uuid; RETURN;
      END IF;
      INSERT INTO team_admin_invitation (organization_id, name, email, target_clerk_user_id,
          invited_by_member, invited_by, adult_attested)
        VALUES (p_org, trim(p_name), wanted, p_target, actor_member, p_actor, true)
        RETURNING id INTO new_id;
      RETURN QUERY SELECT 'created', new_id;
    END $fn$;

    -- Records the Clerk invitation for a pending email invitation.
    CREATE FUNCTION record_team_admin_invitation(p_actor text, p_org uuid, p_id uuid, p_clerk text)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF team_admin_actor(p_actor, p_org) IS NULL THEN RETURN false; END IF;
      UPDATE team_admin_invitation SET clerk_invitation_id = p_clerk
        WHERE id = p_id AND organization_id = p_org AND status = 'pending'
          AND target_clerk_user_id IS NULL;
      RETURN FOUND;
    END $fn$;

    -- A resend replaces the invitation with a new one, so an earlier link or
    -- ID cannot grant access. The original inviter and attestation carry over.
    CREATE FUNCTION resend_team_admin_invitation(p_actor text, p_org uuid, p_id uuid)
    RETURNS TABLE (outcome text, invitation_id uuid, email text, existing_account boolean,
      previous_clerk_invitation_id text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      old team_admin_invitation;
      new_id uuid;
    BEGIN
      IF team_admin_actor(p_actor, p_org) IS NULL THEN
        RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::boolean, NULL::text; RETURN;
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('team_admin_invitation'), hashtext(p_org::text));
      SELECT * INTO old FROM team_admin_invitation i
        WHERE i.id = p_id AND i.organization_id = p_org AND i.status = 'pending' FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::boolean, NULL::text; RETURN;
      END IF;
      UPDATE team_admin_invitation SET status = 'superseded', email = NULL, closed_at = now()
        WHERE id = old.id;
      INSERT INTO team_admin_invitation (organization_id, name, email, target_clerk_user_id,
          invited_by_member, invited_by, adult_attested, policy_version)
        VALUES (p_org, old.name, old.email, old.target_clerk_user_id, old.invited_by_member,
          old.invited_by, old.adult_attested, old.policy_version)
        RETURNING id INTO new_id;
      RETURN QUERY SELECT 'resent', new_id, old.email, old.target_clerk_user_id IS NOT NULL,
        old.clerk_invitation_id;
    END $fn$;

    -- Cancels a pending invitation and clears its email. Returns the Clerk ID to revoke.
    CREATE FUNCTION cancel_team_admin_invitation(p_actor text, p_org uuid, p_id uuid)
    RETURNS TABLE (outcome text, clerk_invitation_id text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      clerk_id text;
    BEGIN
      IF team_admin_actor(p_actor, p_org) IS NULL THEN
        RETURN QUERY SELECT 'forbidden', NULL::text; RETURN;
      END IF;
      UPDATE team_admin_invitation i SET status = 'cancelled', email = NULL, closed_at = now()
        WHERE i.id = p_id AND i.organization_id = p_org AND i.status = 'pending'
        RETURNING i.clerk_invitation_id INTO clerk_id;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found', NULL::text; RETURN;
      END IF;
      RETURN QUERY SELECT 'cancelled', clerk_id;
    END $fn$;

    CREATE FUNCTION list_team_admin_invitations(p_actor text, p_org uuid)
    RETURNS TABLE (id uuid, name text, email text, existing_account boolean,
      invited_by_name text, created_at timestamptz, expires_at timestamptz, sent boolean)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF team_admin_actor(p_actor, p_org) IS NULL THEN RETURN; END IF;
      PERFORM expire_team_admin_invitations(p_org);
      RETURN QUERY
        SELECT i.id, i.name, i.email, i.target_clerk_user_id IS NOT NULL, m.name,
          i.created_at, i.expires_at,
          i.target_clerk_user_id IS NOT NULL OR i.clerk_invitation_id IS NOT NULL
        FROM team_admin_invitation i
        LEFT JOIN member m ON m.organization_id = i.organization_id AND m.id = i.invited_by_member
        WHERE i.organization_id = p_org AND i.status = 'pending'
        ORDER BY i.created_at, i.id;
    END $fn$;

    -- Current admins with an adult approval. Unlinked approvals have not signed in yet.
    CREATE FUNCTION list_team_admins(p_actor text, p_org uuid)
    RETURNS TABLE (member_id uuid, name text, linked boolean, is_self boolean, approved_at timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF team_admin_actor(p_actor, p_org) IS NULL THEN RETURN; END IF;
      RETURN QUERY
        SELECT m.id, m.name, w.clerk_user_id IS NOT NULL, w.clerk_user_id = p_actor, w.approved_at
        FROM web_admin_access w
        JOIN member m ON m.organization_id = w.organization_id AND m.id = w.member_id
        WHERE w.organization_id = p_org AND m.role = 'admin'
        ORDER BY w.approved_at, m.id;
    END $fn$;

    -- Pending invitations bound to an existing account, for it to accept.
    -- Hides invitations whose inviter is no longer an admin.
    CREATE FUNCTION list_account_team_admin_invitations(p_subject text)
    RETURNS TABLE (id uuid, organization_id uuid, organization_name text, team_number integer,
      invited_by_name text, expires_at timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    BEGIN
      IF p_subject IS NULL OR p_subject !~ '^user_[A-Za-z0-9]+$' THEN RETURN; END IF;
      RETURN QUERY
        SELECT i.id, o.id, o.name, o.frc_team_number, m.name, i.expires_at
        FROM team_admin_invitation i
        JOIN organization o ON o.id = i.organization_id
        JOIN member m ON m.organization_id = i.organization_id AND m.id = i.invited_by_member
        WHERE i.target_clerk_user_id = p_subject AND i.status = 'pending'
          AND i.expires_at > now()
          AND team_admin_actor(i.invited_by, i.organization_id) = i.invited_by_member
        ORDER BY o.frc_team_number, i.id;
    END $fn$;

    -- p_emails are the account's Clerk-verified emails. p_from_metadata is true
    -- only when the ID came from server-set Clerk metadata after sign-up; an
    -- email invitation cannot be accepted any other way. Repeats by the same
    -- account return the same result.
    CREATE FUNCTION accept_team_admin_invitation(
      p_id uuid, p_subject text, p_emails text[], p_from_metadata boolean
    ) RETURNS TABLE (outcome text, organization_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      inv team_admin_invitation;
      existing uuid;
      existing_role text;
      new_member uuid;
    BEGIN
      IF p_subject IS NULL OR p_subject !~ '^user_[A-Za-z0-9]+$' THEN
        RETURN QUERY SELECT 'unavailable', NULL::uuid; RETURN;
      END IF;
      SELECT * INTO inv FROM team_admin_invitation i WHERE i.id = p_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'unavailable', NULL::uuid; RETURN;
      END IF;
      IF inv.status = 'accepted' AND inv.accepted_by = p_subject THEN
        RETURN QUERY SELECT 'accepted', inv.organization_id; RETURN;
      END IF;
      IF inv.status <> 'pending' THEN
        RETURN QUERY SELECT 'unavailable', NULL::uuid; RETURN;
      END IF;
      IF inv.expires_at <= now() THEN
        UPDATE team_admin_invitation SET status = 'expired', email = NULL, closed_at = now()
          WHERE id = inv.id;
        RETURN QUERY SELECT 'unavailable', NULL::uuid; RETURN;
      END IF;
      IF (inv.target_clerk_user_id IS NOT NULL AND inv.target_clerk_user_id <> p_subject)
        OR (inv.target_clerk_user_id IS NULL AND p_from_metadata IS NOT TRUE)
        OR NOT (inv.email = ANY (coalesce(p_emails, ARRAY[]::text[])))
        OR team_admin_actor(inv.invited_by, inv.organization_id) IS DISTINCT FROM inv.invited_by_member
      THEN
        RETURN QUERY SELECT 'unavailable', NULL::uuid; RETURN;
      END IF;
      PERFORM set_config('app.organization_id', inv.organization_id::text, true);
      PERFORM pg_advisory_xact_lock(hashtext('team_admin_subject'),
        hashtext(inv.organization_id::text || p_subject));
      SELECT w.member_id, m.role INTO existing, existing_role FROM web_admin_access w
        JOIN member m ON m.organization_id = w.organization_id AND m.id = w.member_id
        WHERE w.organization_id = inv.organization_id AND w.clerk_user_id = p_subject;
      IF FOUND THEN
        -- Never relink or duplicate. A demoted link stays as it is.
        IF existing_role <> 'admin' THEN
          RETURN QUERY SELECT 'unavailable', NULL::uuid; RETURN;
        END IF;
        UPDATE team_admin_invitation SET status = 'accepted', email = NULL, closed_at = now(),
          accepted_by = p_subject, accepted_member_id = existing
          WHERE id = inv.id;
        RETURN QUERY SELECT 'already_admin', inv.organization_id; RETURN;
      END IF;
      -- A new admin member. Telegram identities of other members are never merged.
      INSERT INTO member (organization_id, name, role)
        VALUES (inv.organization_id, inv.name, 'admin') RETURNING id INTO new_member;
      INSERT INTO web_admin_access (organization_id, member_id, clerk_user_id, approved_by, policy_version)
        VALUES (inv.organization_id, new_member, p_subject, inv.invited_by_member, inv.policy_version);
      UPDATE team_admin_invitation SET status = 'accepted', email = NULL, closed_at = now(),
        accepted_by = p_subject, accepted_member_id = new_member
        WHERE id = inv.id;
      RETURN QUERY SELECT 'accepted', inv.organization_id;
    END $fn$;

    REVOKE ALL ON FUNCTION
      team_admin_actor(text, uuid),
      expire_team_admin_invitations(uuid),
      create_team_admin_invitation(text, uuid, text, text, text, boolean),
      record_team_admin_invitation(text, uuid, uuid, text),
      resend_team_admin_invitation(text, uuid, uuid),
      cancel_team_admin_invitation(text, uuid, uuid),
      list_team_admin_invitations(text, uuid),
      list_team_admins(text, uuid),
      list_account_team_admin_invitations(text),
      accept_team_admin_invitation(uuid, text, text[], boolean)
      FROM PUBLIC;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN
        GRANT EXECUTE ON FUNCTION
          create_team_admin_invitation(text, uuid, text, text, text, boolean),
          record_team_admin_invitation(text, uuid, uuid, text),
          resend_team_admin_invitation(text, uuid, uuid),
          cancel_team_admin_invitation(text, uuid, uuid),
          list_team_admin_invitations(text, uuid),
          list_team_admins(text, uuid),
          list_account_team_admin_invitations(text),
          accept_team_admin_invitation(uuid, text, text[], boolean)
          TO ai_scouting_backend;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP FUNCTION accept_team_admin_invitation(uuid, text, text[], boolean);
    DROP FUNCTION list_account_team_admin_invitations(text);
    DROP FUNCTION list_team_admins(text, uuid);
    DROP FUNCTION list_team_admin_invitations(text, uuid);
    DROP FUNCTION cancel_team_admin_invitation(text, uuid, uuid);
    DROP FUNCTION resend_team_admin_invitation(text, uuid, uuid);
    DROP FUNCTION record_team_admin_invitation(text, uuid, uuid, text);
    DROP FUNCTION create_team_admin_invitation(text, uuid, text, text, text, boolean);
    DROP FUNCTION expire_team_admin_invitations(uuid);
    DROP FUNCTION team_admin_actor(text, uuid);
    DROP TABLE team_admin_invitation;
  `.execute(db);
}
