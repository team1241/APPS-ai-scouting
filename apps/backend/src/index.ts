import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { accessApplicationRoutes } from "./access-applications.ts";
import { apiKeyConfig } from "./api-keys.ts";
import { clerkAccounts } from "./clerk-accounts.ts";
import { dataApiRoutes } from "./data-api.ts";
import { createWorkerControl, eventMode } from "./event-mode.ts";
import { extractionConfig } from "./extraction-config.ts";
import { runExtractionPass } from "./extraction-worker.ts";
import { operatorRoutes } from "./operator-review.ts";
import { drainOutbound } from "./outbound-worker.ts";
import { saveAccessApplication } from "./repositories/access-applications.ts";
import { activeApiKey, createApiKey, listApiKeys, revokeApiKey } from "./repositories/api-keys.ts";
import { checkDatabase, closeDatabase } from "./repositories/database.ts";
import { workerEvents } from "./repositories/operations.ts";
import {
  directoryTeam,
  listDirectoryTeams,
  removeDirectoryAdmin,
  revealApiKeyCiphertext,
  revokeDirectoryApiKey,
  TEAMS_PAGE_SIZE,
} from "./repositories/operator-teams.ts";
import {
  applicationLists,
  approveApplication,
  claimApplication,
  claimOperatorInvitation,
  createOperatorInvitation,
  grantOperator,
  invitableApplication,
  listOperatorInvitations,
  listOperators,
  openOperatorInvitation,
  operatorProfile,
  recordInvitation,
  recordOperatorInvitation,
  rejectApplication,
  reviewApplications,
  revokeOperator,
  revokeOperatorInvitation,
} from "./repositories/operators.ts";
import {
  acceptTeamAdminInvitation,
  accountTeamAdminInvitations,
  cancelTeamAdminInvitation,
  createTeamAdminInvitation,
  listTeamAdminInvitations,
  listTeamAdmins,
  recordTeamAdminInvitation,
  resendTeamAdminInvitation,
} from "./repositories/team-admins.ts";
import { organizationIds } from "./repositories/telegram-connect.ts";
import { adminOrganizations, organizationProfile } from "./repositories/web-admin.ts";
import { telegramRoutes } from "./telegram.ts";
import { webAdminRoutes } from "./web-admin.ts";
import { webSessionVerifier } from "./web-auth.ts";
import { startWorkerLoop } from "./worker-loop.ts";

const extraction = extractionConfig(process.env);
const app = new Hono();
app.route("/web/access-applications", accessApplicationRoutes({ save: saveAccessApplication }));
const verifyWebSession = webSessionVerifier(process.env);
const accounts = clerkAccounts(process.env);
const apiKeys = apiKeyConfig(process.env);
app.route(
  "/web/operator",
  operatorRoutes({
    verify: verifyWebSession,
    profile: operatorProfile,
    applications: reviewApplications,
    applicationLists,
    approve: approveApplication,
    reject: rejectApplication,
    invitable: invitableApplication,
    recordInvitation,
    operators: listOperators,
    grantOperator,
    revokeOperator,
    invitations: listOperatorInvitations,
    createInvitation: createOperatorInvitation,
    recordOperatorInvitation,
    openInvitation: openOperatorInvitation,
    revokeInvitation: revokeOperatorInvitation,
    accounts,
    directory: {
      list: listDirectoryTeams,
      team: directoryTeam,
      reveal: revealApiKeyCiphertext,
      pageSize: TEAMS_PAGE_SIZE,
      cipher: apiKeys?.cipher ?? null,
      revokeKey: apiKeys
        ? (subject, org, id) =>
            revokeDirectoryApiKey(subject, org, id, (keyId) => apiKeys.provider.revoke(keyId))
        : null,
      removeAdmin: removeDirectoryAdmin,
    },
  }),
);
app.route(
  "/web",
  webAdminRoutes({
    verify: verifyWebSession,
    organizations: adminOrganizations,
    claim: accounts
      ? async (subject) => {
          const pending = await accounts.pendingClaim(subject);
          if (!pending) return false;
          const operator = pending.operatorInvitationId
            ? await claimOperatorInvitation(subject, pending.operatorInvitationId, pending.emails)
            : false;
          const organization = pending.applicationId
            ? await claimApplication(subject, pending.applicationId, pending.emails)
            : null;
          // Only an email invitation's ID comes from metadata, after sign-up.
          const teamAdmin = pending.teamAdminInvitationId
            ? await acceptTeamAdminInvitation(
                subject,
                pending.teamAdminInvitationId,
                pending.emails,
                true,
              )
            : null;
          return (
            operator ||
            organization !== null ||
            (teamAdmin !== null && teamAdmin.outcome !== "unavailable")
          );
        }
      : null,
    teamAdmins: {
      admins: listTeamAdmins,
      invitations: listTeamAdminInvitations,
      create: createTeamAdminInvitation,
      record: recordTeamAdminInvitation,
      resend: resendTeamAdminInvitation,
      cancel: cancelTeamAdminInvitation,
      accountInvitations: accountTeamAdminInvitations,
      accept: acceptTeamAdminInvitation,
      accounts,
    },
    apiKeys: apiKeys && {
      list: (org, subject) => listApiKeys(org, subject, apiKeys),
      create: (org, subject, name) => createApiKey(org, subject, name, apiKeys),
      revoke: (org, subject, id) => revokeApiKey(org, subject, id, apiKeys),
    },
  }),
);
app.route(
  "/v1",
  dataApiRoutes({
    verify: apiKeys && ((key) => apiKeys.provider.verify(key)),
    active: activeApiKey,
    organization: organizationProfile,
  }),
);

const control = createWorkerControl(eventMode(process.env), async () =>
  (await Promise.all((await organizationIds()).map(workerEvents))).flat(),
);
// Load before accepting traffic; startup failure cannot leave an apparently healthy auto worker.
await control.refresh();
app.use("/telegram/webhook", async (c, next) => {
  await next();
  if (c.res.status === 200) {
    control.wake();
    // Committed event changes become visible without polling the database while idle.
    void control.refresh().catch(() => console.error("Event-window refresh failed"));
  }
});
if (process.env.TELEGRAM_WEBHOOK_SECRET) {
  app.route("/telegram/webhook", telegramRoutes(process.env.TELEGRAM_WEBHOOK_SECRET));
}

// No database query, so a wake-up ping does not wake Neon.
app.get("/health", (c) =>
  c.json({
    ok: true,
    workers: { mode: control.mode, active: control.active() },
    ...(process.env.RAILWAY_GIT_COMMIT_SHA ? { revision: process.env.RAILWAY_GIT_COMMIT_SHA } : {}),
  }),
);

app.get("/health/db", async (c) => {
  await checkDatabase();
  return c.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`backend listening on ${info.port}`);
});

const stops: (() => Promise<void>)[] = [];
if (extraction || process.env.TELEGRAM_BOT_TOKEN) {
  stops.push(
    startWorkerLoop(async () => {
      for (const org of await organizationIds()) {
        if (!control.active()) break;
        try {
          if (extraction) await runExtractionPass(org, extraction.baseUrl, extraction.serviceToken);
          if (process.env.TELEGRAM_BOT_TOKEN)
            await drainOutbound(
              org,
              process.env.TELEGRAM_BOT_TOKEN,
              fetch,
              undefined,
              control.active,
              10,
            );
        } catch {
          console.error("Organization worker pass failed");
        }
      }
    }, control.active),
  );
}
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  control.stop();
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    ...stops.map((stop) => stop()),
  ]);
  await closeDatabase();
  clearTimeout(deadline);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
