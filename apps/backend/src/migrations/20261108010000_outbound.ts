import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE outbound_delivery (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      logical_key text NOT NULL, recipient text NOT NULL, text text NOT NULL,
      session_id uuid, event_id uuid, question boolean NOT NULL DEFAULT false, admin_only boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','ambiguous','failed','exhausted','cancelled')),
      attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 6, lease_token uuid, lease_expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), attempted_at timestamptz, sent_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
      next_attempt_at timestamptz NOT NULL DEFAULT now(), message_id text, error text,
      operator_id uuid, operator_reason text, operator_at timestamptz,
      UNIQUE(organization_id,logical_key,recipient), UNIQUE(organization_id,id),
      FOREIGN KEY(organization_id,session_id) REFERENCES scouting_session(organization_id,id) ON DELETE CASCADE,
      FOREIGN KEY(organization_id,event_id) REFERENCES event(organization_id,id) ON DELETE CASCADE
    );
    CREATE TABLE outbound_intervention (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      delivery_id uuid NOT NULL, actor_id uuid NOT NULL, reason text NOT NULL,
      previous_status text NOT NULL, accepted_duplicate_risk boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(organization_id,delivery_id) REFERENCES outbound_delivery(organization_id,id) ON DELETE CASCADE
    );
    ALTER TABLE outbound_intervention ENABLE ROW LEVEL SECURITY;
    ALTER TABLE outbound_intervention FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON outbound_intervention USING(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN GRANT SELECT,INSERT ON outbound_intervention TO ai_scouting_backend; END IF; END $$;
    CREATE INDEX outbound_due ON outbound_delivery(organization_id,status,next_attempt_at);
    ALTER TABLE outbound_delivery ENABLE ROW LEVEL SECURITY;
    ALTER TABLE outbound_delivery FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON outbound_delivery USING(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_scouting_backend') THEN GRANT SELECT,INSERT,UPDATE ON outbound_delivery TO ai_scouting_backend; END IF; END $$;
    CREATE FUNCTION queue_schedule_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO outbound_delivery(organization_id,logical_key,recipient,text,event_id,admin_only,next_attempt_at,status,sent_at,error)
      VALUES(NEW.organization_id,'schedule:'||NEW.event_id,NEW.telegram_user_id,NEW.text,NEW.event_id,true,NEW.next_attempt_at,
        CASE NEW.status WHEN 'uncertain' THEN 'ambiguous' WHEN 'sending' THEN 'ambiguous' ELSE NEW.status END,NEW.sent_at,NEW.error)
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END $$;
    CREATE TRIGGER schedule_outbox AFTER INSERT ON schedule_notification FOR EACH ROW EXECUTE FUNCTION queue_schedule_delivery();
    INSERT INTO outbound_delivery(organization_id,logical_key,recipient,text,event_id,admin_only,next_attempt_at,status,sent_at,error)
      SELECT organization_id,'schedule:'||event_id,telegram_user_id,text,event_id,true,next_attempt_at,
      CASE status WHEN 'uncertain' THEN 'ambiguous' WHEN 'sending' THEN 'ambiguous' ELSE status END,sent_at,error FROM schedule_notification;
  `.execute(db);
}
export async function down(db: Kysely<any>) {
  await sql`DROP TRIGGER schedule_outbox ON schedule_notification; DROP FUNCTION queue_schedule_delivery(); DROP TABLE outbound_intervention; DROP TABLE outbound_delivery`.execute(
    db,
  );
}
