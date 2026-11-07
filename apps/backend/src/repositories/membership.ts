import type { Transaction } from "kysely";
import type { DB } from "../db.generated.ts";
import { withTenant } from "./tenant.ts";

export async function memberInTransaction(
  tx: Transaction<DB>,
  organizationId: string,
  userId: string,
) {
  return tx
    .selectFrom("channel_identity")
    .innerJoin("member", (join) =>
      join
        .onRef("member.id", "=", "channel_identity.member_id")
        .onRef("member.organization_id", "=", "channel_identity.organization_id"),
    )
    .select(["member.id", "member.role"])
    .where("channel_identity.organization_id", "=", organizationId)
    .where("channel", "=", "telegram")
    .where("external_id", "=", userId)
    .executeTakeFirst();
}
export function memberRole(organizationId: string, userId: string) {
  return withTenant(organizationId, (tx) => memberInTransaction(tx, organizationId, userId));
}
