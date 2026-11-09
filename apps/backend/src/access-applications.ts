import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

export interface AccessApplication {
  id: string;
  name: string;
  email: string;
  teamNumber: number;
  role: "mentor" | "lead_mentor" | "teacher" | "other";
  adultAttested: true;
}

export function validateApplication(input: unknown) {
  const data = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const text = (key: string) => (typeof data[key] === "string" ? data[key].trim() : "");
  const name = text("name");
  const email = text("email").toLowerCase();
  const team = text("teamNumber");
  const role = text("role");
  const errors: Record<string, string> = {};
  const hasControl = (value: string) =>
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    );
  if (!name || name.length > 120 || hasControl(name))
    errors.name = "Enter your name using 120 characters or fewer.";
  if (email.length > 254 || hasControl(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "Enter a valid email address.";
  if (!/^[1-9]\d{0,4}$/.test(team)) errors.teamNumber = "Enter a team number from 1 to 99999.";
  if (!["mentor", "lead_mentor", "teacher", "other"].includes(role))
    errors.role = "Choose your role on the team.";
  if (data.adultAttested !== true)
    errors.adultAttested = "Confirm that you meet the age requirement.";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text("id")))
    errors.id = "Refresh the page and submit your application again.";
  return {
    errors,
    application: {
      id: text("id"),
      name,
      email,
      teamNumber: Number(team),
      role,
      adultAttested: true,
    } as AccessApplication,
  };
}

export function accessApplicationRoutes(deps: {
  save: (input: AccessApplication) => Promise<"received" | "team_exists">;
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.onError((_error, c) => c.json({ error: "Applications are temporarily unavailable." }, 503));
  app.post(
    "/",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json({ error: "Application is too large." }, 413),
    }),
    async (c) => {
      let input: unknown;
      try {
        input = await c.req.json();
      } catch {
        return c.json({ error: "Send a valid application." }, 400);
      }
      const { application, errors } = validateApplication(input);
      if (Object.keys(errors).length) return c.json({ errors }, 400);
      const outcome = await deps.save(application);
      // Any earlier application or organization for this team blocks a new one.
      if (outcome === "team_exists")
        return c.json(
          {
            errors: {
              teamNumber:
                "This team already has an application or account. Contact us if you think this is wrong.",
            },
          },
          409,
        );
      // A retry of the same submission returns the same receipt.
      return c.json({ received: true }, 202);
    },
  );
  return app;
}
