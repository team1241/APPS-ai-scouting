import type { AccessApplication } from "../access-applications.ts";
import { db } from "../db.ts";

export async function saveAccessApplication(input: AccessApplication) {
  await db
    .insertInto("access_application")
    .values({
      id: input.id,
      name: input.name,
      email: input.email,
      team_number: input.teamNumber,
      team_role: input.role,
      adult_attested: input.adultAttested,
    })
    .onConflict((conflict) => conflict.doNothing())
    .execute();
}
