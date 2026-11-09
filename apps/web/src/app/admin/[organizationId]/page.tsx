import Link from "next/link";
import { notFound } from "next/navigation";
import { type ApiKey, ApiKeys } from "@/components/api-keys";
import { PageHeading, TeamNumber } from "@/components/page-heading";
import {
  type AdminInvitation,
  type TeamAdmin,
  TeamAdministrators,
} from "@/components/team-administrators";
import { TeamNavigation } from "@/components/team-navigation";
import { TelegramConnection } from "@/components/telegram-connection";
import { authorizedOrganizations, backendRequest } from "@/lib/backend";

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  // The backend checks admin access for each section itself, so all load together.
  const [organizations, connection, keyList, adminList] = await Promise.all([
    authorizedOrganizations(),
    backendRequest(`/web/organizations/${organizationId}/telegram/state`),
    backendRequest(`/web/organizations/${organizationId}/api-keys`),
    backendRequest(`/web/organizations/${organizationId}/administrators`),
  ]);
  if (organizations === null)
    return (
      <main id="main" className="mx-auto max-w-3xl space-y-4 px-6 py-12">
        <PageHeading>Administration is unavailable</PageHeading>
        <p>We couldn’t check your team access. Try again shortly.</p>
        <Link className="text-primary underline" href="/admin">
          Return to organizations
        </Link>
      </main>
    );
  const organization = organizations.find((org) => org.id === organizationId);
  if (!organization) notFound();
  const state = connection?.ok
    ? ((await connection.json()) as { connected: boolean; connectedAt: string | null })
    : null;
  const keys = keyList?.ok ? ((await keyList.json()) as { keys: ApiKey[] }).keys : null;
  const admins = adminList?.ok
    ? ((await adminList.json()) as { administrators: TeamAdmin[]; invitations: AdminInvitation[] })
    : null;
  return (
    <>
      <TeamNavigation organization={organization} canChangeTeam={organizations.length > 1} />
      <main id="main" className="mx-auto max-w-3xl space-y-8 px-6 py-12">
        <PageHeading description="You administer this team.">
          <TeamNumber value={organization.teamNumber} /> {organization.name}
        </PageHeading>
        <TelegramConnection
          organizationId={organizationId}
          connected={state?.connected ?? null}
          connectedAt={state?.connectedAt ?? null}
        />
        <TeamAdministrators organizationId={organizationId} data={admins} />
        <ApiKeys organizationId={organizationId} keys={keys} />
      </main>
    </>
  );
}
