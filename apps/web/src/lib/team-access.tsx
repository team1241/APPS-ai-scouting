import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { authorizedOrganizations, type Organization } from "@/lib/backend";

// Rechecks team access for a workspace page. Unavailable access renders a page that does not
// assert a selected team; a team the account does not administer is a 404.
export async function teamAccess(
  organizationId: string,
): Promise<
  | { ok: true; organization: Organization; organizations: Organization[] }
  | { ok: false; page: React.ReactNode }
> {
  const organizations = await authorizedOrganizations();
  if (organizations === null)
    return {
      ok: false,
      page: (
        <main id="main" className="mx-auto max-w-3xl space-y-4 px-6 py-12">
          <PageHeading>Administration is unavailable</PageHeading>
          <p>We couldn’t check your team access. Try again shortly.</p>
          <Link className="text-primary underline" href="/admin">
            Return to organizations
          </Link>
        </main>
      ),
    };
  const organization = organizations.find((org) => org.id === organizationId);
  if (!organization) notFound();
  return { ok: true, organization, organizations };
}
