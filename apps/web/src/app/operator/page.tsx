import { notFound } from "next/navigation";
import { ApplicationsUnavailable, OperatorApplications } from "@/components/operator-applications";
import { OperatorNavigation } from "@/components/operator-navigation";
import { operatorAccess, reviewApplications } from "@/lib/operator";

export default async function OperatorPage() {
  const access = await operatorAccess();
  if (access === "denied") notFound();
  if (access === null)
    return (
      <main id="main" className="mx-auto max-w-3xl px-6 py-12">
        <ApplicationsUnavailable />
      </main>
    );
  const [pending, reviewed] = await Promise.all([
    reviewApplications("pending"),
    reviewApplications("reviewed"),
  ]);
  return (
    <>
      <OperatorNavigation />
      <main id="main" className="mx-auto max-w-3xl space-y-10 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold">Access applications</h1>
          <p className="mt-2 text-muted-foreground">
            Approving creates the team, makes the applicant its administrator and sends a Clerk
            invitation to their email.
          </p>
        </div>
        {pending === null || reviewed === null ? (
          <ApplicationsUnavailable />
        ) : (
          <OperatorApplications pending={pending} reviewed={reviewed} />
        )}
      </main>
    </>
  );
}
