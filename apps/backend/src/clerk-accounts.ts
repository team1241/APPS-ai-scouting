import { createClerkClient } from "@clerk/backend";

export interface ClerkAccounts {
  invite(input: { email: string; applicationId: string; resend: boolean }): Promise<string>;
  // Reads only server-controlled public metadata and Clerk-verified emails.
  pendingClaim(subject: string): Promise<{ applicationId: string; emails: string[] } | null>;
  // Returns the account only when the email is verified on exactly one user.
  findVerifiedUser(email: string): Promise<string | null>;
}

const metadataKey = "accessApplicationId";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clerkAccounts(env: NodeJS.ProcessEnv): ClerkAccounts | null {
  if (!env.CLERK_SECRET_KEY) return null;
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const redirectUrl = env.WEB_INVITATION_REDIRECT_URL || undefined;
  return {
    async invite({ email, applicationId, resend }) {
      const invitation = await clerk.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { [metadataKey]: applicationId },
        notify: true,
        // A resend replaces a pending invitation. An existing account still fails.
        ignoreExisting: resend,
        redirectUrl,
      });
      return invitation.id;
    },
    async pendingClaim(subject) {
      const user = await clerk.users.getUser(subject);
      const applicationId = user.publicMetadata?.[metadataKey];
      if (typeof applicationId !== "string" || !uuid.test(applicationId)) return null;
      const emails = user.emailAddresses
        .filter((address) => address.verification?.status === "verified")
        .map((address) => address.emailAddress.trim().toLowerCase());
      return emails.length ? { applicationId, emails } : null;
    },
    async findVerifiedUser(email) {
      const wanted = email.trim().toLowerCase();
      const { data } = await clerk.users.getUserList({ emailAddress: [wanted], limit: 2 });
      const matches = data.filter((user) =>
        user.emailAddresses.some(
          (address) =>
            address.emailAddress.trim().toLowerCase() === wanted &&
            address.verification?.status === "verified",
        ),
      );
      return matches.length === 1 && matches[0] ? matches[0].id : null;
    },
  };
}
