import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationsUnavailable } from "@/components/operator-applications";
import { RemoveTeamAdministrator } from "@/components/operator-team-admins";
import { OperatorTeamKeys } from "@/components/operator-team-keys";
import { PageBody, PageHeading } from "@/components/page-heading";
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
    <section className="rounded-2xl bg-surface shadow-surface" aria-labelledby="admins-title">
      <div className="p-5 sm:p-6">
        <h2 id="admins-title" className="text-[1.0625rem] font-semibold text-foreground">
          Administrators
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Admin members in the team’s records. Only admins with an adult approval who have signed in
          use the web app. “No web access” is an admin without that approval.
        </p>
      </div>
      {administrators.length ? (
        <ul className="divide-y divide-separator border-t border-separator">
          {administrators.map((admin) => {
            const status = webAccess[admin.webAccess];
            return (
              <li
                key={admin.memberId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 sm:px-6"
              >
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-semibold">{admin.name}</p>
                  <p className="text-sm text-muted">
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
        <p className="border-t border-separator px-5 py-4 text-sm text-muted sm:px-6">
          This team has no administrators.
        </p>
      )}
      {invitations.length ? (
        <div className="border-t border-separator">
          <h3 className="px-5 pt-4 text-sm font-semibold sm:px-6">
            Invited <span className="tabular-nums">({invitations.length})</span>
          </h3>
          <ul className="divide-y divide-separator">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 sm:px-6"
              >
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-semibold">{invitation.name}</p>
                  <p className="text-sm text-muted">
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
  const back = (
    <Link
      href="/operator/teams"
      className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-bumper-ink hover:bg-white/10 hover:text-white"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      All teams
    </Link>
  );
  if (access === null || detail === null)
    return (
      <main id="main">
        <PageHeading before={back}>Team unavailable</PageHeading>
        <PageBody>
          <ApplicationsUnavailable href={`/operator/teams/${encodeURIComponent(organizationId)}`} />
        </PageBody>
      </main>
    );
  return (
    <main id="main">
      <PageHeading
        before={back}
        number={detail.team.teamNumber}
        description={
          <>
            Registered <DateText value={detail.team.createdAt} />. You see this team as a platform
            operator, not as one of its admins. You can remove its administrators and revoke its
            keys.
          </>
        }
      >
        {detail.team.name}
      </PageHeading>
      <PageBody>
        <Administrators detail={detail} />
        <OperatorTeamKeys
          organizationId={detail.team.id}
          teamNumber={detail.team.teamNumber}
          keys={detail.keys}
        />
      </PageBody>
    </main>
  );
}
