import { closeDatabase } from "./repositories/database.ts";
import { inspectDeliveries, retryDelivery } from "./repositories/outbound.ts";

const [command, org, user, id, reason, risk] = process.argv.slice(2);
try {
  if (!org || !user)
    throw Error(
      "Usage: delivery-admin.ts list|retry organization-id telegram-admin-id [delivery-id reason accept-duplicate-risk]",
    );
  if (command === "list")
    console.log(JSON.stringify(await inspectDeliveries(org, user, Number(id ?? 0)), null, 2));
  else if (command === "retry" && id && reason)
    await retryDelivery(org, user, id, reason, risk === "accept-duplicate-risk");
  else throw Error("Invalid command");
} finally {
  await closeDatabase();
}
