import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { db } from "./db.ts";
import { sendTelegram } from "./outbound-worker.ts";
import { enrollMember } from "./repositories/members.ts";
import { operationSnapshot, quarantineRestoredDeliveries } from "./repositories/operations.ts";
import {
  claimDelivery,
  enqueueDelivery,
  inspectDeliveries,
  retryDelivery,
  settleDelivery,
} from "./repositories/outbound.ts";
import { withTenant } from "./repositories/tenant.ts";

after(() => db.destroy());
test("durable deduplication, exclusive claims, stale lease ambiguity and authorized recovery", async () => {
  const org = randomUUID(),
    other = randomUUID();
  for (const tenant of [org, other])
    for (const [user, role] of [
      ["1", "admin"],
      ["2", "scout"],
    ] as const)
      await enrollMember({
        organizationId: tenant,
        organizationName: "Outbound test",
        frcTeamNumber: 1241,
        memberName: user,
        role,
        channel: "telegram",
        externalUserId: user,
      });
  try {
    await Promise.all(
      Array.from({ length: 12 }, () =>
        withTenant(org, (tx) =>
          enqueueDelivery(tx, {
            organization_id: org,
            logical_key: "test",
            recipient: "2",
            text: "hello",
            next_attempt_at: new Date(0),
          }),
        ),
      ),
    );
    assert.equal((await inspectDeliveries(org, "1")).length, 1);
    assert.equal((await operationSnapshot(org, "1")).outbound[0]?.count, 1);
    await assert.rejects(operationSnapshot(org, "2"), /Admin/);
    assert.equal((await operationSnapshot(other, "1")).outbound.length, 0);
    await assert.rejects(quarantineRestoredDeliveries(org, "2", "test restore"), /Admin/);
    assert.equal((await quarantineRestoredDeliveries(other, "1", "test restore")).quarantined, 0);
    await assert.rejects(inspectDeliveries(org, "2"), /Admin/);
    assert.equal((await inspectDeliveries(other, "1")).length, 0);
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimDelivery(org)));
    const claimed = claims.filter((row) => row && !row.cancelled);
    assert.equal(claimed.length, 1);
    const row = claimed[0];
    assert.ok(row && !row.cancelled);
    const future = new Date(Date.now() + 120000);
    assert.equal(await claimDelivery(org, future), null);
    assert.equal((await inspectDeliveries(org, "1"))[0]?.status, "ambiguous");
    await assert.rejects(
      settleDelivery(org, row.id, row.lease_token, { status: "sent", messageId: "10" }),
    );
    await assert.rejects(retryDelivery(other, "1", row.id, "investigate", true));
    await assert.rejects(retryDelivery(org, "2", row.id, "investigate", true));
    await assert.rejects(retryDelivery(org, "1", row.id, "investigate", false), /risk/);
    await retryDelivery(org, "1", row.id, "Verified missing in Telegram", true);
    for (let i = 0; i < 6; i++) {
      const next = await claimDelivery(org, new Date(future.getTime() + (i + 1) * 4000000));
      assert.ok(next && !next.cancelled);
      await settleDelivery(
        org,
        next.id,
        next.lease_token,
        { status: "pending", error: "Telegram rejection 503" },
        new Date(future.getTime() + (i + 1) * 4000000),
      );
    }
    assert.equal((await inspectDeliveries(org, "1"))[0]?.status, "exhausted");
    assert.equal((await inspectDeliveries(org, "1"))[0]?.attempts, 7);
    for (const key of ["restore-pending", "restore-sending"])
      await withTenant(org, (tx) =>
        enqueueDelivery(tx, {
          organization_id: org,
          logical_key: key,
          recipient: "2",
          text: "Restored",
          next_attempt_at: new Date(0),
        }),
      );
    const restoredClaim = await claimDelivery(org);
    assert.ok(restoredClaim && !restoredClaim.cancelled);
    assert.equal(
      (await quarantineRestoredDeliveries(org, "1", "Restore test snapshot")).quarantined,
      2,
    );
    assert.equal(await claimDelivery(org), null);
    await assert.rejects(
      settleDelivery(org, restoredClaim.id, restoredClaim.lease_token, {
        status: "sent",
        messageId: "late",
      }),
    );
    const interventions = await withTenant(org, (tx) =>
      tx
        .selectFrom("outbound_intervention")
        .select("id")
        .where("organization_id", "=", org)
        .where("reason", "=", "Restore test snapshot")
        .execute(),
    );
    assert.equal(interventions.length, 2);
  } finally {
    for (const tenant of [org, other])
      await withTenant(tenant, async (tx) => {
        await tx.deleteFrom("channel_identity").where("organization_id", "=", tenant).execute();
        await tx.deleteFrom("member").where("organization_id", "=", tenant).execute();
        await tx.deleteFrom("organization").where("id", "=", tenant).execute();
      });
  }
});
test("Telegram outcomes are redacted and ambiguous transport is never retryable automatically", async () => {
  const mock = (body: unknown, status = 200) =>
    (async () => Response.json(body, { status })) as typeof fetch;
  assert.deepEqual(
    await sendTelegram("SECRET", "1", "x", true, mock({ ok: true, result: { message_id: 42 } })),
    { status: "sent", messageId: "42" },
  );
  assert.deepEqual(
    await sendTelegram(
      "SECRET",
      "1",
      "x",
      false,
      mock({ ok: false, error_code: 429, parameters: { retry_after: 123 } }),
    ),
    { status: "pending", error: "Telegram rejection 429", retryMs: 123000 },
  );
  assert.equal(
    (await sendTelegram("SECRET", "1", "x", false, mock({ ok: false, error_code: 503 }))).status,
    "pending",
  );
  assert.equal(
    (await sendTelegram("SECRET", "1", "x", false, mock({ ok: false, error_code: 403 }))).status,
    "failed",
  );
  assert.equal(
    (
      await sendTelegram("SECRET", "1", "x", false, (async () => {
        throw Error("SECRET");
      }) as typeof fetch)
    ).status,
    "ambiguous",
  );
  assert.equal(
    (await sendTelegram("SECRET", "1", "x", false, mock({ ok: true }))).status,
    "ambiguous",
  );
});

test("a permanent failure never blocks another eligible recipient", async () => {
  const org = randomUUID();
  for (const user of ["1", "2"])
    await enrollMember({
      organizationId: org,
      organizationName: "Isolation",
      frcTeamNumber: 1241,
      memberName: user,
      role: "admin",
      channel: "telegram",
      externalUserId: user,
    });
  try {
    for (const user of ["1", "2"])
      await withTenant(org, (tx) =>
        enqueueDelivery(tx, {
          organization_id: org,
          logical_key: "receipt",
          recipient: user,
          text: "saved",
          next_attempt_at: new Date(0),
          admin_only: true,
        }),
      );
    const { drainOutbound } = await import("./outbound-worker.ts");
    const count = await drainOutbound(org, "SECRET", (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json(
        body.chat_id === "1"
          ? { ok: false, error_code: 403 }
          : { ok: true, result: { message_id: 8 } },
      );
    }) as typeof fetch);
    assert.equal(count, 1);
    assert.deepEqual((await inspectDeliveries(org, "1")).map((row) => row.status).sort(), [
      "failed",
      "sent",
    ]);
  } finally {
    await withTenant(org, async (tx) => {
      await tx.deleteFrom("channel_identity").where("organization_id", "=", org).execute();
      await tx.deleteFrom("member").where("organization_id", "=", org).execute();
      await tx.deleteFrom("organization").where("id", "=", org).execute();
    });
  }
});
