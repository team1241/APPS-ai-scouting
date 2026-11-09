import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  type AccountInvitation,
  AdministratorInvitations,
} from "@/components/administrator-invitations";
import { PageHeading, TeamNumber } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main id="main" className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <PageHeading description="Your current team permissions determine access.">
        Choose your team
      </PageHeading>
      <AdministratorInvitations invitations={invitations} />
      {organizations === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Administration is unavailable</CardTitle>
            <CardDescription>
              We couldn’t check your team access. Try again shortly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/admin">Try again</Link>
            </Button>
          </CardContent>
        </Card>
      ) : organizations.length === 0 ? (
        invitations.length ? null : (
          <Card>
            <CardHeader>
              <CardTitle>No approved teams</CardTitle>
              <CardDescription>
                Your account does not have approved administrator access. Ask your team’s adult lead
                to arrange or restore access.
              </CardDescription>
            </CardHeader>
          </Card>
        )
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {organizations.map((org) => (
            <li key={org.id}>
              <Link
                href={`/admin/${org.id}`}
                className="group flex items-center gap-5 p-6 hover:bg-accent focus-visible:-outline-offset-4"
              >
                <TeamNumber value={org.teamNumber} className="w-24 shrink-0 text-2xl" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="block font-semibold">{org.name}</span>
                  <span className="text-sm text-muted-foreground">Administrator</span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
