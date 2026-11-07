import { type Kysely, sql } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`ALTER TABLE schedule_poll ADD COLUMN roster_received_at timestamptz;
    UPDATE schedule_poll p SET roster_received_at = coalesce(p.received_at,r.succeeded_at)
    FROM reference_sync r WHERE r.organization_id=p.organization_id AND r.event_id=p.event_id
      AND r.complete AND r.succeeded_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM event_team t WHERE t.organization_id=p.organization_id AND t.event_id=p.event_id);`.execute(
    db,
  );
}
export async function down(db: Kysely<any>) {
  await sql`ALTER TABLE schedule_poll DROP COLUMN roster_received_at`.execute(db);
}
