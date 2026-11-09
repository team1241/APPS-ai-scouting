import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ProviderUnavailable, type SecretCipher } from "./api-keys.ts";
import type { ClerkAccounts } from "./clerk-accounts.ts";
import { uuidPattern } from "./event-config.ts";
import type {
  DirectoryPage,
  DirectoryTeamDetail,
  OperatorRevokeOutcome,
  RemoveAdminOutcome,
  RevealOutcome,
} from "./repositories/operator-teams.ts";
import type {
  ApproveOutcome,
  OperatorInvitation,
  OperatorProfile,
  PlatformOperator,
  ReviewApplication,
} from "./repositories/operators.ts";

export interface OperatorDeps {
  verify: ((request: Request) => Promise<string | null>) | null;
  profile: (subject: string) => Promise<OperatorProfile | undefined>;
  applications: (subject: string, status: "pending" | "reviewed") => Promise<ReviewApplication[]>;
  applicationLists: (
    subject: string,
  ) => Promise<{ pending: ReviewApplication[]; reviewed: ReviewApplication[] }>;
  approve: (subject: string, id: string, organizationName: string) => Promise<ApproveOutcome>;
  reject: (subject: string, id: string) => Promise<"forbidden" | "rejected" | "not_pending">;
  invitable: (subject: string, id: string) => Promise<{ id: string; email: string } | undefined>;
  recordInvitation: (subject: string, id: string, invitationId: string) => Promise<boolean>;
  operators: (subject: string) => Promise<PlatformOperator[]>;
  grantOperator: (
    subject: string,
    target: string,
    name: string,
  ) => Promise<"forbidden" | "invalid" | "added" | "exists">;
  revokeOperator: (
    subject: string,
    target: string,
  ) => Promise<"forbidden" | "self" | "removed" | "not_found">;
  invitations: (subject: string) => Promise<OperatorInvitation[]>;
  createInvitation: (
    subject: string,
    email: string,
    name: string,
  ) => Promise<
    { outcome: "created"; id: string } | { outcome: "forbidden" | "invalid" | "exists" }
  >;
  recordOperatorInvitation: (subject: string, id: string, clerkId: string) => Promise<boolean>;
  openInvitation: (
    subject: string,
    id: string,
  ) => Promise<{ email: string; clerkInvitationId: string | null } | undefined>;
  revokeInvitation: (
    subject: string,
    id: string,
  ) => Promise<{
    outcome: "forbidden" | "not_found" | "revoked";
    clerkInvitationId: string | null;
  }>;
  accounts: ClerkAccounts | null;
  // Read-only directory of every team (#41).
  directory: {
    list: (subject: string, search: string, page: number) => Promise<DirectoryPage>;
    team: (subject: string, org: string) => Promise<DirectoryTeamDetail | undefined>;
    reveal: (subject: string, org: string, id: string) => Promise<RevealOutcome>;
    pageSize: number;
    // Null when API keys are not configured. Key values then cannot be shown.
    cipher: SecretCipher | null;
    // Null when API keys are not configured. Keys then cannot be revoked.
    revokeKey:
      | ((subject: string, org: string, id: string) => Promise<OperatorRevokeOutcome>)
      | null;
    removeAdmin: (subject: string, org: string, memberId: string) => Promise<RemoveAdminOutcome>;
  };
}

const clerkUserPattern = /^user_[A-Za-z0-9]+$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const conflict = {
  not_pending: "This application has already been reviewed.",
  team_exists: "This team already has an organization.",
} as const;

export function operatorRoutes(deps: OperatorDeps) {
  const app = new Hono<{ Variables: { subject: string; profile: OperatorProfile } }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    if (!deps.verify) return c.json({ error: "Web authentication unavailable" }, 503);
    const subject = await deps.verify(c.req.raw);
    if (!subject) return c.json({ error: "Sign-in required" }, 401);
    // Every request rechecks the operator record, so removal takes effect at once.
    const profile = await deps.profile(subject);
    if (!profile) return c.json({ error: "Operator access required" }, 403);
    c.set("subject", subject);
    c.set("profile", profile);
    await next();
  });
  app.onError((_error, c) =>
    c.json({ error: "Operator tools are unavailable. Try again shortly." }, 503),
  );

  // Sends the Clerk invitation after the approval commits. A failure leaves the
  // team provisioned and the operator can retry from the review page.
  async function invite(subject: string, id: string, email: string, resend: boolean) {
    if (!deps.accounts) return "unavailable" as const;
    try {
      const invitationId = await deps.accounts.invite({ email, applicationId: id, resend });
      await deps.recordInvitation(subject, id, invitationId);
      return "sent" as const;
    } catch {
      console.error("Access invitation failed");
      return "failed" as const;
    }
  }

  app.get("/", (c) => c.json({ operator: c.get("profile") }));
  // Without a status, both lists come back from one transaction.
  app.get("/applications", async (c) => {
    const status = c.req.query("status");
    if (status !== "pending" && status !== "reviewed")
      return c.json(await deps.applicationLists(c.get("subject")));
    return c.json({ applications: await deps.applications(c.get("subject"), status) });
  });
  app.post(
    "/applications/:id/approve",
    bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "Request is too large." }, 413) }),
    async (c) => {
      const id = c.req.param("id");
      if (!uuidPattern.test(id)) return c.json({ error: "Application unavailable" }, 404);
      const body: unknown = await c.req.json().catch(() => null);
      const name =
        body &&
        typeof body === "object" &&
        "organizationName" in body &&
        typeof body.organizationName === "string"
          ? body.organizationName.trim()
          : "";
      if (!name || name.length > 120 || /\p{Cc}/u.test(name))
        return c.json(
          { errors: { organizationName: "Enter a team name using 120 characters or fewer." } },
          400,
        );
      const subject = c.get("subject");
      const result = await deps.approve(subject, id, name);
      if (result.outcome === "forbidden") return c.json({ error: "Operator access required" }, 403);
      if (result.outcome === "invalid_name")
        return c.json(
          { errors: { organizationName: "Enter a team name using 120 characters or fewer." } },
          400,
        );
      if (result.outcome !== "approved") return c.json({ error: conflict[result.outcome] }, 409);
      return c.json({
        organizationId: result.organizationId,
        invitation: await invite(subject, id, result.email, false),
      });
    },
  );
  app.post("/applications/:id/reject", async (c) => {
    const id = c.req.param("id");
    if (!uuidPattern.test(id)) return c.json({ error: "Application unavailable" }, 404);
    const outcome = await deps.reject(c.get("subject"), id);
    if (outcome === "forbidden") return c.json({ error: "Operator access required" }, 403);
    if (outcome === "not_pending") return c.json({ error: conflict.not_pending }, 409);
    return c.json({ rejected: true });
  });
  app.post("/applications/:id/invitation", async (c) => {
    const id = c.req.param("id");
    if (!uuidPattern.test(id)) return c.json({ error: "Application unavailable" }, 404);
    const subject = c.get("subject");
    const application = await deps.invitable(subject, id);
    if (!application) return c.json({ error: "No invitation is needed." }, 409);
    return c.json({ invitation: await invite(subject, id, application.email, true) });
  });

  // The operators page needs both lists, so they load together.
  app.get("/operators", async (c) => {
    const subject = c.get("subject");
    const [operators, invitations] = await Promise.all([
      deps.operators(subject),
      deps.invitations(subject),
    ]);
    return c.json({
      operators: operators.map((operator) => ({
        ...operator,
        isSelf: operator.clerkUserId === subject,
      })),
      invitations,
    });
  });
  app.post(
    "/operators",
    bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "Request is too large." }, 413) }),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      const field = (key: string) => {
        const value =
          body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
        return typeof value === "string" ? value.trim() : "";
      };
      const name = field("name");
      const email = field("email").toLowerCase();
      const errors: Record<string, string> = {};
      if (!name || name.length > 120 || /\p{Cc}/u.test(name))
        errors.name = "Enter a name using 120 characters or fewer.";
      if (email.length > 254 || !emailPattern.test(email))
        errors.email = "Enter a valid email address.";
      if (Object.keys(errors).length) return c.json({ errors }, 400);
      if (!deps.accounts) return c.json({ error: "Account lookup is not configured." }, 503);
      const subject = c.get("subject");
      const accounts = deps.accounts;
      const target = await accounts.findVerifiedUser(email);
      if (!target) {
        // No account yet: invite them. They become an operator on first sign-in.
        const created = await deps.createInvitation(subject, email, name);
        if (created.outcome !== "created") {
          if (created.outcome === "forbidden")
            return c.json({ error: "Operator access required" }, 403);
          if (created.outcome === "invalid")
            return c.json({ errors: { email: "Enter a valid email address." } }, 400);
          return c.json({ errors: { email: "This email already has an open invitation." } }, 409);
        }
        try {
          const clerkId = await accounts.inviteOperator({ email, invitationId: created.id });
          await deps.recordOperatorInvitation(subject, created.id, clerkId);
        } catch {
          console.error("Operator invitation failed");
          await deps.revokeInvitation(subject, created.id);
          return c.json(
            {
              error:
                "We couldn’t send the invitation. If this email already has an account, ask them to verify it, then add them again.",
            },
            502,
          );
        }
        return c.json({ invited: true }, 202);
      }
      const outcome = await deps.grantOperator(subject, target, name);
      if (outcome === "forbidden") return c.json({ error: "Operator access required" }, 403);
      if (outcome === "invalid")
        return c.json({ errors: { name: "Enter a name using 120 characters or fewer." } }, 400);
      if (outcome === "exists")
        return c.json({ errors: { email: "This person is already an operator." } }, 409);
      return c.json({ added: true }, 201);
    },
  );
  app.delete("/operators/:id", async (c) => {
    const target = c.req.param("id");
    if (!clerkUserPattern.test(target)) return c.json({ error: "Operator not found." }, 404);
    const outcome = await deps.revokeOperator(c.get("subject"), target);
    if (outcome === "forbidden") return c.json({ error: "Operator access required" }, 403);
    if (outcome === "self") return c.json({ error: "You can’t remove yourself." }, 409);
    if (outcome === "not_found") return c.json({ error: "Operator not found." }, 404);
    return c.json({ removed: true });
  });

  app.get("/operator-invitations", async (c) =>
    c.json({ invitations: await deps.invitations(c.get("subject")) }),
  );
  app.post("/operator-invitations/:id/resend", async (c) => {
    const id = c.req.param("id");
    if (!uuidPattern.test(id)) return c.json({ error: "Invitation not found." }, 404);
    if (!deps.accounts) return c.json({ error: "Invitations are not configured." }, 503);
    const subject = c.get("subject");
    const open = await deps.openInvitation(subject, id);
    if (!open) return c.json({ error: "Invitation not found." }, 404);
    try {
      // Replace the earlier Clerk invitation so only one link works.
      if (open.clerkInvitationId)
        await deps.accounts.revokeInvitation(open.clerkInvitationId).catch(() => undefined);
      const clerkId = await deps.accounts.inviteOperator({ email: open.email, invitationId: id });
      await deps.recordOperatorInvitation(subject, id, clerkId);
    } catch {
      console.error("Operator invitation resend failed");
      return c.json({ error: "We couldn’t resend the invitation. Try again." }, 502);
    }
    return c.json({ sent: true });
  });
  app.delete("/operator-invitations/:id", async (c) => {
    const id = c.req.param("id");
    if (!uuidPattern.test(id)) return c.json({ error: "Invitation not found." }, 404);
    const result = await deps.revokeInvitation(c.get("subject"), id);
    if (result.outcome === "forbidden") return c.json({ error: "Operator access required" }, 403);
    if (result.outcome === "not_found") return c.json({ error: "Invitation not found." }, 404);
    // The database record is closed first, so a failed Clerk revoke cannot grant access.
    if (result.clerkInvitationId && deps.accounts)
      await deps.accounts
        .revokeInvitation(result.clerkInvitationId)
        .catch(() => console.error("Clerk invitation revoke failed"));
    return c.json({ cancelled: true });
  });

  app.get("/teams", async (c) => {
    const search = (c.req.query("q") ?? "").trim();
    if (search.length > 120 || /\p{Cc}/u.test(search))
      return c.json({ error: "Search with 120 characters or fewer." }, 400);
    const pageText = c.req.query("page") ?? "1";
    const page = /^[1-9][0-9]{0,4}$/.test(pageText) ? Number(pageText) : 0;
    if (!page) return c.json({ error: "Page not found." }, 400);
    const result = await deps.directory.list(c.get("subject"), search, page);
    return c.json({ ...result, page, pageSize: deps.directory.pageSize });
  });
  app.get("/teams/:id", async (c) => {
    const id = c.req.param("id");
    if (!uuidPattern.test(id)) return c.json({ error: "Team not found." }, 404);
    const detail = await deps.directory.team(c.get("subject"), id);
    if (!detail) return c.json({ error: "Team not found." }, 404);
    return c.json(detail);
  });
  // POST, so the value never sits in a URL, a cache or browser history.
  app.post("/teams/:id/api-keys/:keyId/reveal", async (c) => {
    const org = c.req.param("id");
    const keyId = c.req.param("keyId");
    if (!uuidPattern.test(org) || !uuidPattern.test(keyId))
      return c.json({ error: "Key not found." }, 404);
    const result = await deps.directory.reveal(c.get("subject"), org, keyId);
    if (result.outcome !== "revealed") {
      if (result.outcome === "forbidden") return c.json({ error: "Operator access required" }, 403);
      if (result.outcome === "not_found") return c.json({ error: "Key not found." }, 404);
      return c.json(
        { error: "This key was revoked. Its value was erased and can’t be shown." },
        409,
      );
    }
    if (!deps.directory.cipher)
      return c.json(
        { error: "Key values are unavailable because API keys are not configured." },
        503,
      );
    let secret: string;
    try {
      secret = deps.directory.cipher.decrypt(result.ciphertext);
    } catch {
      // Never log the ciphertext or the error, which can hold key material.
      console.error("Operator key decryption failed");
      return c.json({ error: "This key’s stored value can’t be read." }, 503);
    }
    return c.json({ secret });
  });
  app.post("/teams/:id/api-keys/:keyId/revoke", async (c) => {
    const org = c.req.param("id");
    const keyId = c.req.param("keyId");
    if (!uuidPattern.test(org) || !uuidPattern.test(keyId))
      return c.json({ error: "Key not found." }, 404);
    if (!deps.directory.revokeKey)
      return c.json({ error: "Keys can’t be revoked because API keys are not configured." }, 503);
    let outcome: OperatorRevokeOutcome;
    try {
      outcome = await deps.directory.revokeKey(c.get("subject"), org, keyId);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
      console.error("Operator key revoke failed at the provider");
      return c.json(
        { error: "The key service didn’t respond. The key is still active. Try again." },
        502,
      );
    }
    if (outcome === "forbidden") return c.json({ error: "Operator access required" }, 403);
    if (outcome === "not_found") return c.json({ error: "Key not found." }, 404);
    // Already revoked is the outcome the operator asked for.
    return c.json({ revoked: true });
  });
  app.post("/teams/:id/administrators/:memberId/remove", async (c) => {
    const org = c.req.param("id");
    const memberId = c.req.param("memberId");
    if (!uuidPattern.test(org) || !uuidPattern.test(memberId))
      return c.json({ error: "Administrator not found." }, 404);
    const result = await deps.directory.removeAdmin(c.get("subject"), org, memberId);
    if (result.outcome !== "removed") {
      if (result.outcome === "forbidden") return c.json({ error: "Operator access required" }, 403);
      return c.json({ error: "This person is no longer an administrator of the team." }, 404);
    }
    // The invitations are already closed in the database, so a failed Clerk
    // revoke leaves only a link that can't be accepted.
    if (deps.accounts)
      for (const id of result.clerkInvitationIds)
        await deps.accounts
          .revokeInvitation(id)
          .catch(() => console.error("Clerk invitation revoke failed"));
    return c.json({ removed: true });
  });
  return app;
}
