import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ClerkAccounts } from "./clerk-accounts.ts";
import { uuidPattern } from "./event-config.ts";
import type {
  AcceptOutcome,
  AccountInvitation,
  CreateOutcome,
  ResendOutcome,
  TeamAdmin,
  TeamAdminInvitation,
} from "./repositories/team-admins.ts";

export interface TeamAdminDeps {
  admins: (subject: string, org: string) => Promise<TeamAdmin[]>;
  invitations: (subject: string, org: string) => Promise<TeamAdminInvitation[]>;
  create: (input: {
    actor: string;
    org: string;
    email: string;
    name: string;
    target: string | null;
    adultAttested: boolean;
  }) => Promise<CreateOutcome>;
  record: (subject: string, org: string, id: string, clerkId: string) => Promise<boolean>;
  resend: (subject: string, org: string, id: string) => Promise<ResendOutcome>;
  cancel: (
    subject: string,
    org: string,
    id: string,
  ) => Promise<{
    outcome: "forbidden" | "not_found" | "cancelled";
    clerkInvitationId: string | null;
  }>;
  accountInvitations: (subject: string) => Promise<AccountInvitation[]>;
  accept: (
    subject: string,
    id: string,
    emails: string[],
    fromMetadata: boolean,
  ) => Promise<AcceptOutcome>;
  accounts: ClerkAccounts | null;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const unavailableTeam = { error: "Organization unavailable" };
const notFound = { error: "Invitation not found." };
const sendFailed =
  "We couldn’t send the invitation email, so no invitation was saved. Check the address and try again.";

// Mounted inside the web admin routes, after the session check sets `subject`.
// A request for a team the account does not administer gets the same 404 as a
// team that does not exist.
export function teamAdminRoutes(deps: TeamAdminDeps) {
  const app = new Hono<{ Variables: { subject: string } }>();
  const base = "/organizations/:id/administrators";
  // The wildcard also matches the list path itself.
  app.use(`${base}/*`, async (c, next) => {
    if (!uuidPattern.test(c.req.param("id") ?? "")) return c.json(unavailableTeam, 404);
    await next();
  });

  // The acting admin is always in the list, so an empty list means no access.
  app.get(base, async (c) => {
    const subject = c.get("subject");
    const org = c.req.param("id");
    const [administrators, invitations] = await Promise.all([
      deps.admins(subject, org),
      deps.invitations(subject, org),
    ]);
    if (!administrators.length) return c.json(unavailableTeam, 404);
    return c.json({ administrators, invitations });
  });

  app.post(
    `${base}/invitations`,
    bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "Request is too large." }, 413) }),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const text = (key: string) =>
        typeof record[key] === "string" ? (record[key] as string).trim() : "";
      const name = text("name");
      const email = text("email").toLowerCase();
      const errors: Record<string, string> = {};
      if (!name || name.length > 120 || /\p{Cc}/u.test(name))
        errors.name = "Enter a name using 120 characters or fewer.";
      if (email.length > 254 || !emailPattern.test(email))
        errors.email = "Enter a valid email address.";
      if (record.adultAttested !== true)
        errors.adultAttested = "Confirm that this person is an adult and may administer the team.";
      if (Object.keys(errors).length) return c.json({ errors }, 400);
      if (!deps.accounts) return c.json({ error: "Invitations are not configured." }, 503);
      const accounts = deps.accounts;
      const subject = c.get("subject");
      const org = c.req.param("id");
      // A pending invitation needs no Clerk lookup, so check access first.
      if (!(await deps.admins(subject, org)).length) return c.json(unavailableTeam, 404);
      const target = await accounts.findVerifiedUser(email);
      const created = await deps.create({
        actor: subject,
        org,
        email,
        name,
        target,
        adultAttested: true,
      });
      if (created.outcome !== "created") {
        if (created.outcome === "forbidden") return c.json(unavailableTeam, 404);
        if (created.outcome === "invalid")
          return c.json({ errors: { email: "Enter a valid email address." } }, 400);
        return c.json(
          {
            errors: {
              email:
                created.outcome === "already_admin"
                  ? "This person is already an administrator of this team."
                  : "This email already has a pending invitation.",
            },
          },
          409,
        );
      }
      // An existing account accepts in the app. No email is sent.
      if (target) return c.json({ invitation: "account" }, 201);
      try {
        const clerkId = await accounts.inviteTeamAdmin({ email, invitationId: created.id });
        await deps.record(subject, org, created.id, clerkId);
      } catch {
        console.error("Team admin invitation failed");
        await deps.cancel(subject, org, created.id);
        return c.json({ error: sendFailed }, 502);
      }
      return c.json({ invitation: "email" }, 201);
    },
  );

  app.post(`${base}/invitations/:invitationId/resend`, async (c) => {
    const id = c.req.param("invitationId");
    if (!uuidPattern.test(id)) return c.json(notFound, 404);
    if (!deps.accounts) return c.json({ error: "Invitations are not configured." }, 503);
    const accounts = deps.accounts;
    const subject = c.get("subject");
    const org = c.req.param("id") ?? "";
    const resent = await deps.resend(subject, org, id);
    if (resent.outcome !== "resent")
      return resent.outcome === "forbidden" ? c.json(unavailableTeam, 404) : c.json(notFound, 404);
    // The replaced Clerk link stops working. Its invitation is already closed.
    if (resent.previousClerkInvitationId)
      await accounts
        .revokeInvitation(resent.previousClerkInvitationId)
        .catch(() => console.error("Clerk invitation revoke failed"));
    if (resent.existingAccount) return c.json({ invitation: "account" });
    try {
      const clerkId = await accounts.inviteTeamAdmin({
        email: resent.email,
        invitationId: resent.id,
      });
      await deps.record(subject, org, resent.id, clerkId);
    } catch {
      console.error("Team admin invitation resend failed");
      // The new invitation stays pending and shows "Email not sent".
      return c.json({ error: "We couldn’t send the invitation email. Try again." }, 502);
    }
    return c.json({ invitation: "email" });
  });

  app.delete(`${base}/invitations/:invitationId`, async (c) => {
    const id = c.req.param("invitationId");
    if (!uuidPattern.test(id)) return c.json(notFound, 404);
    const result = await deps.cancel(c.get("subject"), c.req.param("id") ?? "", id);
    if (result.outcome === "forbidden") return c.json(unavailableTeam, 404);
    if (result.outcome === "not_found") return c.json(notFound, 404);
    // The database record closes first, so a failed Clerk revoke cannot grant access.
    if (result.clerkInvitationId && deps.accounts)
      await deps.accounts
        .revokeInvitation(result.clerkInvitationId)
        .catch(() => console.error("Clerk invitation revoke failed"));
    return c.json({ cancelled: true });
  });

  // Invitations waiting for the signed-in account to accept.
  app.get("/administrator-invitations", async (c) =>
    c.json({ invitations: await deps.accountInvitations(c.get("subject")) }),
  );
  app.post("/administrator-invitations/:invitationId/accept", async (c) => {
    const id = c.req.param("invitationId");
    if (!uuidPattern.test(id)) return c.json(notFound, 404);
    if (!deps.accounts) return c.json({ error: "Invitations are not configured." }, 503);
    const subject = c.get("subject");
    const emails = await deps.accounts.verifiedEmails(subject);
    const result = await deps.accept(subject, id, emails, false);
    if (result.outcome === "unavailable")
      return c.json(
        {
          error:
            "This invitation is no longer available. Ask a team administrator to invite you again.",
        },
        409,
      );
    return c.json({ organizationId: result.organizationId, outcome: result.outcome });
  });
  return app;
}
