import { LinkButton } from "@/components/link-button";
import { PageBody, PageHeading } from "@/components/page-heading";

export default function NotFound() {
  return (
    <main id="main">
      <PageHeading description="Check your current access or choose another organization.">
        Workspace unavailable
      </PageHeading>
      <PageBody>
        <LinkButton href="/admin" variant="secondary">
          Choose an organization
        </LinkButton>
      </PageBody>
    </main>
  );
}
