import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { DraftEditor } from "@/components/specifications/draft-editor";
import { TeamNavigation } from "@/components/team-navigation";
import { backendRequest } from "@/lib/backend";
import {
  type Draft,
  nextVersion,
  type PublicationSummary,
  specificationsPath,
} from "@/lib/specifications";
import { teamAccess } from "@/lib/team-access";

export const metadata = { title: "Edit specification" };

export default async function DraftPage({
  params,
}: {
  params: Promise<{ organizationId: string; draftId: string }>;
}) {
  const { organizationId, draftId } = await params;
  const base = `/web/organizations/${organizationId}/specifications`;
  const [access, draftResponse, listResponse] = await Promise.all([
    teamAccess(organizationId),
    backendRequest(`${base}/drafts/${encodeURIComponent(draftId)}`),
    backendRequest(base),
  ]);
  if (!access.ok) return access.page;
  const navigation = (
    <TeamNavigation
      organization={access.organization}
      canChangeTeam={access.organizations.length > 1}
    />
  );
  if (!draftResponse?.ok || !listResponse?.ok) {
    const missing = draftResponse?.status === 404;
    return (
      <>
        {navigation}
        <main id="main" className="mx-auto max-w-3xl space-y-4 px-6 py-12">
          <PageHeading>{missing ? "Draft not found" : "This draft is unavailable"}</PageHeading>
          <p>
            {missing
              ? "It was published or deleted. Published versions are listed with the team’s specifications."
              : "We couldn’t load the draft. Try again shortly."}
          </p>
          <Link className="text-primary underline" href={specificationsPath(organizationId)}>
            Back to specifications
          </Link>
        </main>
      </>
    );
  }
  const { draft } = (await draftResponse.json()) as { draft: Draft };
  const { publications } = (await listResponse.json()) as { publications: PublicationSummary[] };
  return (
    <>
      {navigation}
      <main id="main">
        <DraftEditor
          key={draft.id}
          organizationId={organizationId}
          draft={draft}
          nextVersion={nextVersion(publications, draft.season, draft.kind)}
        />
      </main>
    </>
  );
}
