import { notFound } from "next/navigation";
import { ApplicationsUnavailable } from "@/components/operator-applications";
import {
  AddOperatorForm,
  InvitationActions,
  RemoveOperator,
} from "@/components/operator-management";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge } from "@/components/status-badge";
import { operatorAccess, operatorLists } from "@/lib/operator";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

export default async function OperatorsPage() {
  // The access check is shared with the layout; the lists load alongside it.
  const [access, lists] = await Promise.all([operatorAccess(), operatorLists()]);
  if (access === "denied") notFound();
  const operators = access === null ? null : (lists?.operators ?? null);
  const invitations = access === null ? null : (lists?.invitations ?? null);
  const now = Date.now();
  return (
    <main id="main" className="mx-auto max-w-3xl space-y-10 px-6 py-12">
      <PageHeading description="Operators review access applications and manage this list. They don’t get access to any team’s data.">
        Operators
      </PageHeading>
      {operators === null || invitations === null ? (
        <ApplicationsUnavailable href="/operator/operators" />
      ) : (
        <>
          <section aria-labelledby="current-heading" className="space-y-4">
            <h2 id="current-heading" className="text-lg font-semibold">
              Current operators <span className="tabular-nums">({operators.length})</span>
            </h2>
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {operators.map((operator) => (
                <li
                  key={operator.clerkUserId}
                  className="flex flex-col gap-2 p-6 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold">
                      {operator.name}
                      {operator.isSelf ? <StatusBadge tone="neutral">You</StatusBadge> : null}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Added{" "}
                      <time dateTime={operator.createdAt}>
                        {dateFormat.format(new Date(operator.createdAt))}
                      </time>
                      {operator.addedByName ? ` by ${operator.addedByName}` : " by setup command"}
                    </p>
                  </div>
                  {operator.isSelf ? null : (
                    <RemoveOperator clerkUserId={operator.clerkUserId} name={operator.name} />
                  )}
                </li>
              ))}
            </ul>
          </section>
          {invitations.length ? (
            <section aria-labelledby="invited-heading" className="space-y-4">
              <h2 id="invited-heading" className="text-lg font-semibold">
                Invited <span className="tabular-nums">({invitations.length})</span>
              </h2>
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {invitations.map((invitation) => {
                  const expired = new Date(invitation.expiresAt).getTime() <= now;
                  return (
                    <li
                      key={invitation.id}
                      className="flex flex-col gap-3 p-6 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 [overflow-wrap:anywhere]">
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold">
                          {invitation.name}
                          {!invitation.sent ? (
                            <StatusBadge tone="danger">Not sent</StatusBadge>
                          ) : expired ? (
                            <StatusBadge tone="danger">Expired</StatusBadge>
                          ) : (
                            <StatusBadge tone="waiting">Invited</StatusBadge>
                          )}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{invitation.email}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {!invitation.sent ? (
                            "The email failed. Resend to try again."
                          ) : expired ? (
                            "Resend to give them another 7 days."
                          ) : (
                            <>
                              Expires{" "}
                              <time dateTime={invitation.expiresAt}>
                                {dateFormat.format(new Date(invitation.expiresAt))}
                              </time>
                              {invitation.invitedByName
                                ? ` · Invited by ${invitation.invitedByName}`
                                : null}
                            </>
                          )}
                        </p>
                      </div>
                      <InvitationActions invitationId={invitation.id} email={invitation.email} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="add-heading" className="space-y-4">
            <div>
              <h2 id="add-heading" className="text-lg font-semibold">
                Add an operator
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                People with an account become operators right away. Anyone else gets an email
                invitation that expires in 7 days.
              </p>
            </div>
            <AddOperatorForm />
          </section>
        </>
      )}
    </main>
  );
}
