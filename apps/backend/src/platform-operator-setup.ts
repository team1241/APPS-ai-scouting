import { closeDatabase } from "./repositories/database.ts";
import { addOperator, removeOperator } from "./repositories/operators.ts";

// Operator-only, using the migration/owner connection. Runtime has SELECT only.
const [command, subject, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ").trim();
try {
  if (!subject || !/^user_[A-Za-z0-9]+$/.test(subject)) throw Error("Clerk user ID required");
  if (command === "add" && name && name.length <= 120) {
    await addOperator(subject, name);
    console.log("Recorded platform operator. They can now review access applications.");
  } else if (command === "remove") {
    const removed = await removeOperator(subject);
    console.log(removed ? "Removed platform operator." : "No platform operator had that ID.");
  } else
    throw Error(
      "Usage: platform-operator-setup.ts add <clerk-user-id> <name> | remove <clerk-user-id>",
    );
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith("Usage")
      ? error.message
      : "Platform operator setup failed. Check the Clerk user ID, name and database connection.",
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
