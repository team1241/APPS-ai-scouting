import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authorizedOrganizations } from "@/lib/backend";
import { operatorAccess } from "@/lib/operator";

export default async function OrganizationsPage() {
  // Sequential on purpose: loading teams claims a pending operator invitation first.
  const organizations = await authorizedOrganizations();
  const operator = await operatorAccess();
  const isOperator = Boolean(operator && operator !== "denied");
  return (
    <main id="main" className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Choose your organization</h1>
          <p className="mt-2 text-muted-foreground">
            Your current team permissions determine access.
          </p>
        </div>
        {isOperator ? (
          <Button asChild variant="outline" className="h-11 shrink-0">
            <Link href="/operator">Review applications</Link>
          </Button>
        ) : null}
      </div>
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
        <Card>
          <CardHeader>
            <CardTitle>No approved organizations</CardTitle>
            <CardDescription>
              {isOperator
                ? "You don’t administer a team yet. As an operator, you can review access applications."
                : "Your account does not have approved administrator access. Ask your team’s adult lead to arrange or restore access."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {organizations.map((org) => (
            <li key={org.id}>
              <Link
                href={`/admin/${org.id}`}
                className="flex items-center justify-between gap-4 p-6 hover:bg-accent focus-visible:-outline-offset-4"
              >
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="block font-semibold">{org.name}</span>
                  <span className="text-sm text-muted-foreground">
                    Team {org.teamNumber} · Administrator
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
