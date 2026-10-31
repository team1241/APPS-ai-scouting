import { sql, type Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import { db } from "../db.ts";

// Context is transaction-local so pooled connections cannot leak tenant identity.
export function withTenant<T>(
  organizationId: string,
  operation: (tx: Transaction<DB>) => Promise<T>,
) {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.organization_id', ${organizationId}, true)`.execute(tx);
    return operation(tx);
  });
}
