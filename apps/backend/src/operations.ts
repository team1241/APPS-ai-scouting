import { closeDatabase } from "./repositories/database.ts";
import { operationSnapshot, quarantineRestoredDeliveries } from "./repositories/operations.ts";

const [org, user, command, reason] = process.argv.slice(2);
try {
  if (!org || !user) throw Error("Usage: operations.ts organization-id telegram-admin-id");
  if (command === "quarantine-restored" && reason)
    console.log(await quarantineRestoredDeliveries(org, user, reason));
  else if (!command) console.log(JSON.stringify(await operationSnapshot(org, user), null, 2));
  else throw Error("Unknown operation or missing restore reason");
} finally {
  await closeDatabase();
}
