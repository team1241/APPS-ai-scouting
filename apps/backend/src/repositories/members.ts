import { withTenant } from "./tenant.ts";

interface Enrollment {
  organizationId: string;
  organizationName: string;
  frcTeamNumber: number;
  memberName: string;
  role: "scout" | "strategist" | "admin";
  channel: string;
  externalUserId: string;
}

export function enrollMember(input: Enrollment) {
  return withTenant(input.organizationId, async (tx) => {
    await tx
      .insertInto("organization")
      .values({
        id: input.organizationId,
        name: input.organizationName,
        frc_team_number: input.frcTeamNumber,
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    // Serialize enrollment within a tenant to avoid duplicate members on retries.
    await tx
      .selectFrom("organization")
      .select("id")
      .where("id", "=", input.organizationId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const existing = await tx
      .selectFrom("channel_identity")
      .select("member_id")
      .where("organization_id", "=", input.organizationId)
      .where("channel", "=", input.channel)
      .where("external_id", "=", input.externalUserId)
      .executeTakeFirst();
    if (existing) return existing.member_id;
    const member = await tx
      .insertInto("member")
      .values({
        organization_id: input.organizationId,
        name: input.memberName,
        role: input.role,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("channel_identity")
      .values({
        organization_id: input.organizationId,
        member_id: member.id,
        channel: input.channel,
        external_id: input.externalUserId,
      })
      .execute();
    return member.id;
  });
}
