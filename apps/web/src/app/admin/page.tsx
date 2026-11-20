import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  type AccountInvitation,
  AdministratorInvitations,
} from "@/components/administrator-invitations";
import { LinkButton } from "@/components/link-button";
import { NoticeCard } from "@/components/notice-card";
import { PageBody, PageHeading } from "@/components/page-heading";
import { authorizedOrganizations, backendRequest } from "@/lib/backend";
import { operatorAccess } from "@/lib/operator";

export default async function OrganizationsPage() {
  // Loading teams claims a pending invitation from Clerk metadata first. The
  // in-app invitations do not depend on that claim, so they load alongside.
  const [organizations, invitationList] = await Promise.all([
    authorizedOrganizations(),
    backendRequest("/web/administrator-invitations"),
  ]);
  const invitations = invitationList?.ok
    ? ((await invitationList.json()) as { invitations: AccountInvitation[] }).invitations
    : [];
  // An operator without a team or invitation has nothing to choose here.
  // Only those accounts need the operator check.
  if (organizations?.length === 0 && !invitations.length) {
    const operator = await operatorAccess();
    if (operator && operator !== "denied") redirect("/operator");
  }
  return (
    <main id="main">
      <PageHeading description="Your current team permissions determine access.">
        Choose your team
      </PageHeading>
      <PageBody className="space-y-8">
        <AdministratorInvitations invitations={invitations} />
        {organizations === null ? (
          <NoticeCard
            title="Administration is unavailable"
            description="We couldn’t check your team access. Try again shortly."
          >
            <LinkButton href="/admin" variant="secondary">
              Try again
            </LinkButton>
          </NoticeCard>
        ) : organizations.length === 0 ? (
          invitations.length ? null : (
            <NoticeCard
              title="No approved teams"
              description="Your account does not have approved administrator access. Ask your team’s adult lead to arrange or restore access."
            />
          )
        ) : (
          <ul className="grid gap-3">
            {organizations.map((org) => (
              <li key={org.id}>
                <Link
                  href={`/admin/${org.id}`}
                  className="group flex items-center gap-4 rounded-2xl bg-surface p-3 pr-5 shadow-surface transition-[box-shadow,translate] hover:-translate-y-px hover:shadow-overlay focus-visible:outline-offset-2 motion-reduce:transition-none sm:gap-5"
                >
                  <span className="font-bumper flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-bumper text-2xl text-white sm:w-28 sm:text-3xl">
                    <span className="sr-only">Team </span>
                    {org.teamNumber}
                  </span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="block text-lg font-semibold leading-snug">{org.name}</span>
                    <span className="text-sm text-muted">Administrator</span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </main>
  );
}
