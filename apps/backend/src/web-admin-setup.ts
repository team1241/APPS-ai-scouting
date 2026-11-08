import { uuidPattern } from "./event-config.ts";
import { closeDatabase } from "./repositories/database.ts";
import { approveWebAdmin, linkWebAdmin, revokeWebAdmin } from "./repositories/web-admin.ts";

const [command, org, member, value, attestation] = process.argv.slice(2);
try {
  if (!org || !member || !uuidPattern.test(org) || !uuidPattern.test(member))
    throw Error("Organization and member UUIDs are required");
  if (
    command === "approve" &&
    value &&
    uuidPattern.test(value) &&
    attestation === "--attest-approved-adult"
  ) {
    await approveWebAdmin({ organizationId: org, memberId: member, approverId: value });
    console.log("Recorded adult administrator approval. Invite this adult through Clerk next.");
  } else if (command === "link" && value && /^user_[A-Za-z0-9]+$/.test(value)) {
    await linkWebAdmin(org, member, value);
    console.log("Linked approved administrator to the verified Clerk account.");
  } else if (command === "revoke") {
    await revokeWebAdmin(org, member);
    console.log("Revoked web administration access.");
  } else
    throw Error(
      "Usage: web-admin-setup.ts approve <org> <member> <approver> --attest-approved-adult | link <org> <member> <clerk-subject> | revoke <org> <member>",
    );
} catch {
  console.error(
    "Web access setup failed. Check arguments, current admin roles, and existing links. No account was automatically linked.",
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
