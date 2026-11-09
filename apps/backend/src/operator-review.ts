import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ClerkAccounts } from "./clerk-accounts.ts";
import { uuidPattern } from "./event-config.ts";
import type {
  ApproveOutcome,
  PlatformOperator,
  ReviewApplication,
} from "./repositories/operators.ts";

export interface OperatorDeps {
  verify: ((request: Request) => Promise<string | null>) | null;
  profile: (subject: string) => Promise<{ name: string } | undefined>;
  applications: (subject: string, status: "pending" | "reviewed") => Promise<ReviewApplication[]>;
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
  accounts: ClerkAccounts | null;
}

const clerkUserPattern = /^user_[A-Za-z0-9]+$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const conflict = {
  not_pending: "This application has already been reviewed.",
  team_exists: "This team already has an organization.",
} as const;

export function operatorRoutes(deps: OperatorDeps) {
  const app = new Hono<{ Variables: { subject: string } }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    if (!deps.verify) return c.json({ error: "Web authentication unavailable" }, 503);
    const subject = await deps.verify(c.req.raw);
    if (!subject) return c.json({ error: "Sign-in required" }, 401);
    // Every request rechecks the operator record, so removal takes effect at once.
    if (!(await deps.profile(subject))) return c.json({ error: "Operator access required" }, 403);
    c.set("subject", subject);
    await next();
  });
  app.onError((_error, c) => c.json({ error: "Application review unavailable" }, 503));

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

  app.get("/", async (c) => c.json({ operator: await deps.profile(c.get("subject")) }));
  app.get("/applications", async (c) => {
    const status = c.req.query("status") === "reviewed" ? "reviewed" : "pending";
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

  app.get("/operators", async (c) => {
    const subject = c.get("subject");
    const operators = await deps.operators(subject);
    return c.json({
      operators: operators.map((operator) => ({
        ...operator,
        isSelf: operator.clerkUserId === subject,
      })),
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
      const target = await deps.accounts.findVerifiedUser(email);
      if (!target)
        return c.json(
          {
            errors: {
              email:
                "No account has this verified email. Invite them in Clerk, then add them after they sign in.",
            },
          },
          422,
        );
      const outcome = await deps.grantOperator(c.get("subject"), target, name);
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
  return app;
}
