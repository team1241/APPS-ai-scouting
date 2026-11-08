import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { sql } from "kysely";
import { db } from "./db.ts";
import { enrollMember } from "./repositories/members.ts";
import {
  adminOrganizations,
  approveWebAdmin,
  linkWebAdmin,
  revokeWebAdmin,
} from "./repositories/web-admin.ts";

after(() => db.destroy());

test("only explicitly approved linked adults with current admin roles receive organizations", async () => {
  const org = randomUUID();
  const other = randomUUID();
  const subject = `user_${randomUUID().replaceAll("-", "")}`;
  const enroll = (organizationId: string, role: "admin" | "scout") =>
    enrollMember({
      organizationId,
      organizationName: "Web access fixture",
      frcTeamNumber: 1241,
      memberName: "Test",
      role,
      channel: "telegram",
      externalUserId: randomUUID(),
    });
  const member = await enroll(org, "admin");
  const scout = await enroll(org, "scout");
  const outsider = await enroll(other, "admin");
  try {
    await assert.rejects(
      approveWebAdmin({ organizationId: org, memberId: scout, approverId: member }),
    );
    await assert.rejects(
      approveWebAdmin({ organizationId: org, memberId: member, approverId: outsider }),
    );
    await assert.rejects(linkWebAdmin(org, member, subject));
    await approveWebAdmin({ organizationId: org, memberId: member, approverId: member });
    assert.deepEqual(await adminOrganizations(subject), []);
    await linkWebAdmin(org, member, subject);
    await assert.rejects(linkWebAdmin(org, member, "user_someoneelse"));
    assert.deepEqual(
      (await adminOrganizations(subject)).map((row) => row.id),
      [org],
    );
    assert.deepEqual(await adminOrganizations("user_unlinked"), []);
    await db.updateTable("member").set({ role: "scout" }).where("id", "=", member).execute();
    assert.deepEqual(await adminOrganizations(subject), []);
    await db.updateTable("member").set({ role: "admin" }).where("id", "=", member).execute();
    await revokeWebAdmin(org, member);
    assert.deepEqual(await adminOrganizations(subject), []);
    await approveWebAdmin({ organizationId: org, memberId: member, approverId: member });
    await linkWebAdmin(org, member, subject);
    await db.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
    await db.deleteFrom("member").where("id", "=", member).execute();
    assert.deepEqual(await adminOrganizations(subject), []);
    await approveWebAdmin({ organizationId: other, memberId: outsider, approverId: outsider });
    await linkWebAdmin(other, outsider, "user_other");
    // A restricted role may discover only the subject it was given and cannot
    // self-approve. Runtime SQL injection is outside this trust boundary.
    const role = `web_test_${randomUUID().replaceAll("-", "")}`;
    await sql`CREATE ROLE ${sql.id(role)} NOLOGIN`.execute(db);
    try {
      await sql`GRANT SELECT ON web_admin_access TO ${sql.id(role)}`.execute(db);
      await db
        .transaction()
        .execute(async (tx) => {
          await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(tx);
          const rows = await tx.selectFrom("web_admin_access").selectAll().execute();
          assert.equal(rows.length, 0);
          await sql`select set_config('app.clerk_user_id', 'user_other', true)`.execute(tx);
          const own = await tx.selectFrom("web_admin_access").selectAll().execute();
          assert.deepEqual(
            own.map((row) => row.organization_id),
            [other],
          );
          await sql`select set_config('app.clerk_user_id', ${subject}, true)`.execute(tx);
          assert.equal((await tx.selectFrom("web_admin_access").selectAll().execute()).length, 0);
          await assert.rejects(
            tx
              .insertInto("web_admin_access")
              .values({ organization_id: org, member_id: scout, approved_by: scout })
              .execute(),
          );
        })
        .catch((error) => {
          if (!(error instanceof Error && error.message.includes("transaction is aborted")))
            throw error;
        });
    } finally {
      await sql`DROP OWNED BY ${sql.id(role)}`.execute(db);
      await sql`DROP ROLE ${sql.id(role)}`.execute(db);
    }
  } finally {
    for (const organizationId of [org, other]) {
      await db
        .deleteFrom("web_admin_access")
        .where("organization_id", "=", organizationId)
        .execute();
      await db
        .deleteFrom("channel_identity")
        .where("organization_id", "=", organizationId)
        .execute();
      await db.deleteFrom("member").where("organization_id", "=", organizationId).execute();
      await db.deleteFrom("organization").where("id", "=", organizationId).execute();
    }
  }
});
