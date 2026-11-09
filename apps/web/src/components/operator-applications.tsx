import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { PendingReview, ResendInvitation } from "@/components/application-review";
import { TeamNumber } from "@/components/page-heading";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReviewApplication } from "@/lib/operator";
import { cn } from "@/lib/utils";

const roles: Record<ReviewApplication["role"], string> = {
  mentor: "Mentor",
  lead_mentor: "Lead mentor",
  teacher: "Teacher",
  other: "Other role",
};

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

function DateText({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
}

// Team number column, then who applied. Shared by pending and reviewed rows.
function Applicant({
  application,
  children,
}: {
  application: ReviewApplication;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-5">
      <TeamNumber value={application.teamNumber} className="w-24 shrink-0 text-2xl leading-8" />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="font-semibold leading-8">{application.name}</p>
        <p className="text-sm text-muted-foreground">
          {roles[application.role]} · {application.email}
        </p>
        {children}
      </div>
    </div>
  );
}

function ReviewedStatus({ application }: { application: ReviewApplication }) {
  const [badge, date] =
    application.status === "rejected"
      ? [
          <StatusBadge key="b" tone="neutral">
            Rejected
          </StatusBadge>,
          application.reviewedAt,
        ]
      : application.claimedAt
        ? [
            <StatusBadge key="b" tone="success">
              Signed in
            </StatusBadge>,
            application.claimedAt,
          ]
        : application.invitedAt
          ? [
              <StatusBadge key="b" tone="waiting">
                Invited
              </StatusBadge>,
              application.invitedAt,
            ]
          : [
              <StatusBadge key="b" tone="danger">
                Invitation not sent
              </StatusBadge>,
              null,
            ];
  const needsInvitation = application.status === "approved" && !application.claimedAt;
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      {badge}
      {date ? (
        <p className="text-sm text-muted-foreground">
          <DateText value={date} />
        </p>
      ) : null}
      {needsInvitation ? <ResendInvitation applicationId={application.id} /> : null}
    </div>
  );
}

export function ApplicationsUnavailable({ href = "/operator" }: { href?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Operator tools are unavailable</CardTitle>
        <CardDescription>We couldn’t load this page. Try again shortly.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={href}>Try again</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// Outcome of the last approve or reject, read back from the reviewed list.
export function ReviewNotice({
  application,
  outcome,
}: {
  application: ReviewApplication;
  outcome: "approved" | "rejected";
}) {
  const team = `Team ${application.teamNumber}`;
  const notSent = outcome === "approved" && !application.invitedAt && !application.claimedAt;
  const message =
    outcome === "rejected"
      ? `${team}’s application was rejected.`
      : notSent
        ? `${team} is set up, but the invitation to ${application.email} was not sent. Use Resend invitation below.`
        : `${team} is set up. We emailed an invitation to ${application.email}.`;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg py-2 pr-2 pl-4 text-sm font-medium",
        notSent ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success",
      )}
    >
      <p className="py-1.5">{message}</p>
      <Link
        href="/operator"
        scroll={false}
        aria-label="Dismiss"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
      >
        <X aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}

export function OperatorApplications({
  pending,
  reviewed,
  highlight,
}: {
  pending: ReviewApplication[];
  reviewed: ReviewApplication[];
  highlight?: string;
}) {
  return (
    <>
      <section aria-labelledby="pending-heading" className="space-y-4">
        <h2 id="pending-heading" className="text-lg font-semibold">
          Waiting for review <span className="tabular-nums">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing to review. New requests from the access form appear here.
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {pending.map((application) => (
              <li key={application.id} className="space-y-5 p-6">
                <Applicant application={application}>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                    <span>
                      Submitted <DateText value={application.createdAt} />
                    </span>
                    <a
                      href={`https://www.thebluealliance.com/team/${application.teamNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
                    >
                      Check team on The Blue Alliance
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </p>
                </Applicant>
                <div className="sm:pl-29">
                  <PendingReview
                    applicationId={application.id}
                    teamNumber={application.teamNumber}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="reviewed-heading" className="space-y-4">
        <h2 id="reviewed-heading" className="text-lg font-semibold">
          Recently reviewed
        </h2>
        {reviewed.length === 0 ? (
          <p className="text-muted-foreground">Approved and rejected applications appear here.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {reviewed.map((application) => (
              <li
                key={application.id}
                className={cn(
                  "flex flex-col gap-3 p-6 sm:flex-row sm:items-start sm:justify-between",
                  application.id === highlight && "bg-accent/60",
                )}
              >
                <Applicant application={application} />
                <div className="pl-29 sm:pl-0">
                  <ReviewedStatus application={application} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
