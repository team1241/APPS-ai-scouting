import { notFound } from "next/navigation";
import { LinkButton } from "@/components/link-button";
import { PageBody, PageHeading } from "@/components/page-heading";
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
        <main id="main">
          <PageHeading description="We couldn’t check your team access. Try again shortly.">
            Administration is unavailable
          </PageHeading>
          <PageBody>
            <LinkButton href="/admin" variant="secondary">
              Return to organizations
            </LinkButton>
          </PageBody>
        </main>
      ),
    };
  const organization = organizations.find((org) => org.id === organizationId);
  if (!organization) notFound();
  return { ok: true, organization, organizations };
}
