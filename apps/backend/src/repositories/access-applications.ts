import { sql } from "kysely";
import type { AccessApplication } from "../access-applications.ts";
import { db } from "../db.ts";

// The runtime cannot read applications. The database function applies the
// duplicate-team rule and returns only whether this team can apply.
export async function saveAccessApplication(input: AccessApplication) {
  const { rows } = await sql<{ outcome: "received" | "team_exists" }>`
    select submit_access_application(
      ${input.id}::uuid, ${input.name}, ${input.email}, ${input.teamNumber},
      ${input.role}, ${input.adultAttested}
    ) as outcome`.execute(db);
  const outcome = rows[0]?.outcome;
  if (outcome !== "received" && outcome !== "team_exists") throw Error("Unexpected outcome");
  return outcome;
}
