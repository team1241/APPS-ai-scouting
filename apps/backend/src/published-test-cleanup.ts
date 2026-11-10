// Administrative disposable-database fixture teardown only. Never imported by runtime.
import { sql, type Transaction } from "kysely";
import type { DB } from "./db.generated.ts";
export async function cleanupPublished(tx: Transaction<DB>, org: string) {
  await sql`ALTER TABLE published_specification DISABLE TRIGGER immutable_specification`.execute(
    tx,
  );
  await sql`ALTER TABLE observation_revision DISABLE TRIGGER immutable_observation`.execute(tx);
  await sql`ALTER TABLE observation_flag DISABLE TRIGGER immutable_flag`.execute(tx);
  await tx.deleteFrom("observation_flag").where("organization_id", "=", org).execute();
  await sql`ALTER TABLE observation_flag ENABLE TRIGGER immutable_flag`.execute(tx);
  await tx
    .updateTable("scouting_session")
    .set({ replaces_revision_id: null })
    .where("organization_id", "=", org)
    .execute();
  await tx.deleteFrom("observation_revision").where("organization_id", "=", org).execute();
  // Sessions reference their pinned publication.
  await tx.deleteFrom("scouting_session").where("organization_id", "=", org).execute();
  await tx
    .deleteFrom("event_specification_assignment")
    .where("organization_id", "=", org)
    .execute();
  await tx.deleteFrom("specification_draft").where("organization_id", "=", org).execute();
  await tx.deleteFrom("published_specification").where("organization_id", "=", org).execute();
  await sql`ALTER TABLE observation_revision ENABLE TRIGGER immutable_observation`.execute(tx);
  await sql`ALTER TABLE published_specification ENABLE TRIGGER immutable_specification`.execute(tx);
}
