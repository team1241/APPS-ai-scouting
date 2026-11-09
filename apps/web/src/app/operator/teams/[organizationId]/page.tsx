import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationsUnavailable } from "@/components/operator-applications";
import { RemoveTeamAdministrator } from "@/components/operator-team-admins";
import { OperatorTeamKeys } from "@/components/operator-team-keys";
import { PageHeading, TeamNumber } from "@/components/page-heading";
import { StatusBadge } from "@/components/status-badge";
import { type DirectoryTeamDetail, directoryTeam, operatorAccess } from "@/lib/operator";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

function DateText({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
}

const webAccess = {
  linked: { tone: "success", label: "Signed in" },
  approved: { tone: "neutral", label: "Not signed in yet" },
  none: { tone: "warning", label: "No web access" },
} as const;

function Administrators({ detail }: { detail: DirectoryTeamDetail }) {
  const { administrators, invitations } = detail;
  return (
    <section className="rounded-xl border bg-card" aria-labelledby="admins-title">
      <div className="p-6">
        <h2 id="admins-title" className="text-lg font-semibold">
          Administrators
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin members in the team’s records. Only admins with an adult approval who have signed in
          use the web app. “No web access” is an admin without that approval.
        </p>
      </div>
      {administrators.length ? (
        <ul className="divide-y border-t">
          {administrators.map((admin) => {
            const status = webAccess[admin.webAccess];
            return (
              <li
                key={admin.memberId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4"
              >
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-medium">{admin.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {admin.approvedAt ? (
                      <>
                        Approved for web access <DateText value={admin.approvedAt} />
                      </>
                    ) : (
                      <>
                        Admin since <DateText value={admin.addedAt} />
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  <RemoveTeamAdministrator
                    organizationId={detail.team.id}
                    teamNumber={detail.team.teamNumber}
                    memberId={admin.memberId}
                    name={admin.name}
                    last={administrators.length === 1}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          This team has no administrators.
        </p>
      )}
      {invitations.length ? (
        <div className="border-t">
          <h3 className="px-6 pt-4 text-sm font-semibold">
            Invited <span className="tabular-nums">({invitations.length})</span>
          </h3>
          <ul className="divide-y">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4"
              >
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-medium">{invitation.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Expires <DateText value={invitation.expiresAt} />
                    {invitation.invitedByName ? ` · Invited by ${invitation.invitedByName}` : null}
                  </p>
                </div>
                {!invitation.sent ? (
                  <StatusBadge tone="danger">Email not sent</StatusBadge>
                ) : invitation.existingAccount ? (
                  <StatusBadge tone="waiting">Waiting to accept</StatusBadge>
                ) : (
                  <StatusBadge tone="waiting">Email sent</StatusBadge>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default async function OperatorTeamPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  // The access check is shared with the layout; the team loads alongside it.
  const [access, detail] = await Promise.all([operatorAccess(), directoryTeam(organizationId)]);
  if (access === "denied" || detail === "missing") notFound();
  return (
    <main id="main" className="mx-auto max-w-3xl space-y-8 px-6 pt-6 pb-12">
      <Link
        href="/operator/teams"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        All teams
      </Link>
      {access === null || detail === null ? (
        <ApplicationsUnavailable href={`/operator/teams/${encodeURIComponent(organizationId)}`} />
      ) : (
        <>
          <PageHeading
            description={
              <>
                Registered <DateText value={detail.team.createdAt} />. You see this team as a
                platform operator, not as one of its admins. You can remove its administrators and
                revoke its keys.
              </>
            }
          >
            <TeamNumber value={detail.team.teamNumber} /> {detail.team.name}
          </PageHeading>
          <Administrators detail={detail} />
          <OperatorTeamKeys
            organizationId={detail.team.id}
            teamNumber={detail.team.teamNumber}
            keys={detail.keys}
          />
        </>
      )}
    </main>
  );
}
