import { notFound } from "next/navigation";
import {
  ApplicationsUnavailable,
  OperatorApplications,
  ReviewNotice,
} from "@/components/operator-applications";
import { PageBody, PageHeading } from "@/components/page-heading";
import { applicationLists, operatorAccess } from "@/lib/operator";

export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<{ approved?: string; rejected?: string }>;
}) {
  const { approved, rejected } = await searchParams;
  // The access check is shared with the layout; the lists load alongside it.
  const [access, lists] = await Promise.all([operatorAccess(), applicationLists()]);
  if (access === "denied") notFound();
  if (access === null)
    return (
      <main id="main">
        <PageHeading>Access applications</PageHeading>
        <PageBody>
          <ApplicationsUnavailable />
        </PageBody>
      </main>
    );
  const pending = lists?.pending ?? null;
  const reviewed = lists?.reviewed ?? null;
  const outcome = approved ? "approved" : rejected ? "rejected" : null;
  const reviewedId = approved ?? rejected;
  const noticed = reviewedId ? reviewed?.find((item) => item.id === reviewedId) : undefined;
  return (
    <main id="main">
      <PageHeading description="Approving creates the team, makes the applicant its administrator and emails them an invitation.">
        Access applications
      </PageHeading>
      <PageBody className="space-y-10">
        {noticed && outcome ? <ReviewNotice application={noticed} outcome={outcome} /> : null}
        {pending === null || reviewed === null ? (
          <ApplicationsUnavailable />
        ) : (
          <OperatorApplications pending={pending} reviewed={reviewed} highlight={noticed?.id} />
        )}
      </PageBody>
    </main>
  );
}
