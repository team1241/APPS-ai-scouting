import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import {
  createInvitation,
  joinInvitation,
  listInvitations,
  memberRole,
  revokeInvitation,
} from "./repositories/invitations.ts";
import { enrollMember } from "./repositories/members.ts";
import { withTenant } from "./repositories/tenant.ts";
import { telegramRoutes } from "./telegram.ts";

test("reusable invitations enforce admins, tenant isolation, revocation and idempotent scout enrollment", async () => {
  const org = randomUUID(),
    other = randomUUID();
  try {
    for (const id of [org, other])
      await enrollMember({
        organizationId: id,
        organizationName: "Invite test",
        frcTeamNumber: 1241,
        memberName: "Admin",
        role: "admin",
        channel: "telegram",
        externalUserId: "1",
      });
    assert.equal((await createInvitation(org, "unknown", "0", "Denied")).status, "forbidden");
    const invite = await createInvitation(org, "1", "100", "Team scouts");
    assert.equal(invite.status, "created");
    if (invite.status !== "created") throw Error("No invite");
    assert.equal((await createInvitation(org, "1", "100", "Retry")).status, "duplicate");
    assert.equal(await joinInvitation(other, "2", "Scout", invite.token), "invalid");
    const joined = await Promise.all([
      joinInvitation(org, "2", "Scout A", invite.token),
      joinInvitation(org, "2", "Scout A", invite.token),
    ]);
    assert.deepEqual(joined.sort(), ["already_joined", "joined"]);
    assert.equal(await joinInvitation(org, "3", "Scout B", invite.token), "joined");
    assert.equal((await memberRole(org, "2"))?.role, "scout");
    assert.equal(await listInvitations(org, "2"), null);
    assert.equal(await revokeInvitation(org, "2", invite.id), "forbidden");
    const list = await listInvitations(org, "1");
    assert.equal(list?.[0]?.uses, 2);
    assert.equal(await revokeInvitation(other, "1", invite.id), "missing");
    assert.equal(await revokeInvitation(org, "1", invite.id), "revoked");
    assert.equal(await joinInvitation(org, "4", "Scout C", invite.token), "invalid");
    assert.equal((await memberRole(org, "2"))?.role, "scout");
    const app = telegramRoutes(org, "test-secret");
    const response = await app.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-secret",
      },
      body: JSON.stringify({
        update_id: 123,
        message: { from: { id: 2 }, chat: { id: 2, type: "private" }, text: "/invites" },
      }),
    });
    assert.match((await response.json()).text, /Only team admins/);
    const rows = await withTenant(org, (tx) =>
      tx.selectFrom("raw_entry").selectAll().where("organization_id", "=", org).execute(),
    );
    assert.equal(rows.length, 0);
  } finally {
    for (const id of [org, other])
      await withTenant(id, async (tx) => {
        for (const table of ["invitation", "channel_identity", "member"] as const)
          await tx.deleteFrom(table).where("organization_id", "=", id).execute();
        await tx.deleteFrom("organization").where("id", "=", id).execute();
      });
    await db.destroy();
  }
});
