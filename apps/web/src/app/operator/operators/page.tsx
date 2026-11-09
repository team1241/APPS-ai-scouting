import { notFound } from "next/navigation";
import { ApplicationsUnavailable } from "@/components/operator-applications";
import { AddOperatorForm, RemoveOperator } from "@/components/operator-management";
import { OperatorNavigation } from "@/components/operator-navigation";
import { operatorAccess, platformOperators } from "@/lib/operator";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

export default async function OperatorsPage() {
  const access = await operatorAccess();
  if (access === "denied") notFound();
  const operators = access === null ? null : await platformOperators();
  return (
    <>
      {access === null ? null : <OperatorNavigation />}
      <main id="main" className="mx-auto max-w-3xl space-y-10 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold">Operators</h1>
          <p className="mt-2 text-muted-foreground">
            Operators review access applications and manage this list. They don’t get access to any
            team’s data.
          </p>
        </div>
        {operators === null ? (
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
                      <p className="font-semibold">
                        {operator.name}
                        {operator.isSelf ? (
                          <span className="font-normal text-muted-foreground"> (you)</span>
                        ) : null}
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
            <section aria-labelledby="add-heading" className="space-y-4">
              <div>
                <h2 id="add-heading" className="text-lg font-semibold">
                  Add an operator
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  They need a signed-in account first. Sign-in is invite-only, so invite new people
                  in Clerk.
                </p>
              </div>
              <AddOperatorForm />
            </section>
          </>
        )}
      </main>
    </>
  );
}
