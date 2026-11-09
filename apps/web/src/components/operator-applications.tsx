import Link from "next/link";
import { PendingReview, ResendInvitation } from "@/components/application-review";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReviewApplication } from "@/lib/operator";

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

function Applicant({ application }: { application: ReviewApplication }) {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <p className="font-semibold">
        <span className="tabular-nums">Team {application.teamNumber}</span>
        <span aria-hidden="true" className="px-2 text-muted-foreground">
          ·
        </span>
        {application.name}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {roles[application.role]} · {application.email}
      </p>
    </div>
  );
}

function ReviewedStatus({ application }: { application: ReviewApplication }) {
  if (application.status === "rejected")
    return (
      <p className="text-sm text-muted-foreground">
        Rejected {application.reviewedAt ? <DateText value={application.reviewedAt} /> : null}
      </p>
    );
  if (application.claimedAt)
    return (
      <p className="text-sm">
        Approved · Signed in <DateText value={application.claimedAt} />
      </p>
    );
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {application.invitedAt ? (
          <>
            Approved · Invited <DateText value={application.invitedAt} />
          </>
        ) : (
          <span className="font-medium text-destructive">Approved · Invitation not sent</span>
        )}
      </p>
      <ResendInvitation applicationId={application.id} />
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

export function OperatorApplications({
  pending,
  reviewed,
}: {
  pending: ReviewApplication[];
  reviewed: ReviewApplication[];
}) {
  return (
    <>
      <section aria-labelledby="pending-heading" className="space-y-4">
        <h2 id="pending-heading" className="text-lg font-semibold">
          Waiting for review <span className="tabular-nums">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-muted-foreground">
            No applications are waiting. New requests from the access form appear here.
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {pending.map((application) => (
              <li key={application.id} className="space-y-4 p-6">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <Applicant application={application} />
                  <p className="shrink-0 text-sm text-muted-foreground">
                    Submitted <DateText value={application.createdAt} />
                  </p>
                </div>
                <PendingReview applicationId={application.id} teamNumber={application.teamNumber} />
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
          <p className="rounded-lg border bg-card p-6 text-muted-foreground">
            Approved and rejected applications appear here.
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {reviewed.map((application) => (
              <li
                key={application.id}
                className="flex flex-col gap-3 p-6 sm:flex-row sm:items-start sm:justify-between"
              >
                <Applicant application={application} />
                <div className="shrink-0 sm:text-right">
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
