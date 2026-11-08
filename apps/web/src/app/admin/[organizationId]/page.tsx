import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamNavigation } from "@/components/team-navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authorizedOrganizations } from "@/lib/backend";

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const organizations = await authorizedOrganizations();
  if (organizations === null)
    return (
      <main id="main" className="mx-auto max-w-3xl space-y-4 px-6 py-12">
        <h1 className="text-2xl font-semibold">Administration is unavailable</h1>
        <p>We couldn’t check your team access. Try again shortly.</p>
        <Link className="text-primary underline" href="/admin">
          Return to organizations
        </Link>
      </main>
    );
  const organization = organizations.find((org) => org.id === organizationId);
  if (!organization) notFound();
  return (
    <>
      <TeamNavigation organization={organization} canChangeTeam={organizations.length > 1} />
      <main id="main" className="mx-auto max-w-3xl space-y-8 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold">{organization.name}</h1>
          <p className="mt-2 text-muted-foreground">
            Team {organization.teamNumber} · Administrator workspace
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Your workspace is ready</CardTitle>
            <CardDescription>
              API-key management will be available here in a future update. Any integration keys
              will read only this organization’s data.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    </>
  );
}
