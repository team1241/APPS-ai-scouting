import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading, TeamNumber } from "@/components/page-heading";
import { TeamNavigation } from "@/components/team-navigation";
import { TelegramConnection } from "@/components/telegram-connection";
import { authorizedOrganizations, backendRequest } from "@/lib/backend";

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  // The backend checks admin access for the Telegram state itself, so both load together.
  const [organizations, connection] = await Promise.all([
    authorizedOrganizations(),
    backendRequest(`/web/organizations/${organizationId}/telegram/state`),
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
      </main>
    </>
  );
}
