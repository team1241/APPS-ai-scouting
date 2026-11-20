import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/link-button";
import { ApplicationsUnavailable } from "@/components/operator-applications";
import { PageBody, PageHeading, TeamNumber } from "@/components/page-heading";
import { StatusBadge } from "@/components/status-badge";
import { type DirectoryTeam, directoryPage, operatorAccess } from "@/lib/operator";
import { TeamSearch } from "./team-search";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function pageHref(search: string, page: number) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/operator/teams?${query}` : "/operator/teams";
}

function TeamRow({ team }: { team: DirectoryTeam }) {
  return (
    <li>
      <Link
        href={`/operator/teams/${team.id}`}
        className="group flex items-start gap-4 p-5 transition-colors outline-none hover:bg-surface-secondary focus-visible:bg-accent-soft focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset sm:gap-5 sm:p-6 motion-reduce:transition-none"
      >
        <TeamNumber
          value={team.teamNumber}
          className="w-16 shrink-0 text-xl leading-8 sm:w-24 sm:text-2xl"
        />
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <p className="font-semibold leading-8">{team.name}</p>
          <p className="text-sm text-muted">
            Registered{" "}
            <time dateTime={team.createdAt}>{dateFormat.format(new Date(team.createdAt))}</time>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span>
              {plural(team.adminCount, "admin", "admins")}
              {" · "}
              {team.webAdminCount} signed in
            </span>
            <span>{plural(team.activeKeyCount, "active key", "active keys")}</span>
            {team.webAdminCount === 0 ? (
              <StatusBadge tone="warning">No signed-in admin</StatusBadge>
            ) : null}
            {team.pendingInvitationCount ? (
              <StatusBadge tone="waiting">
                {plural(team.pendingInvitationCount, "invitation", "invitations")}
              </StatusBadge>
            ) : null}
          </p>
        </div>
        <ChevronRight
          aria-hidden="true"
          className="mt-2 size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
        />
      </Link>
    </li>
  );
}

export default async function TeamsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const search = (typeof params.q === "string" ? params.q : "").trim().slice(0, 120);
  const pageText = typeof params.page === "string" ? params.page : "1";
  const page = /^[1-9][0-9]{0,4}$/.test(pageText) ? Number(pageText) : 1;
  // The access check is shared with the layout; the page loads alongside it.
  const [access, result] = await Promise.all([operatorAccess(), directoryPage(search, page)]);
  if (access === "denied") notFound();
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const first = result ? (page - 1) * result.pageSize + 1 : 0;
  const last = result ? first + result.teams.length - 1 : 0;
  return (
    <main id="main">
      <PageHeading description="Every registered team on the platform. Only operators see this list. Opening a team does not make you one of its admins.">
        All teams
      </PageHeading>
      <PageBody className="space-y-8">
        <TeamSearch search={search} />
        {access === null || result === null ? (
          <ApplicationsUnavailable href={pageHref(search, page)} />
        ) : (
          <section aria-labelledby="teams-heading" className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="teams-heading" className="font-display text-xl text-foreground">
                {search ? (
                  <>
                    Teams matching “<span className="[overflow-wrap:anywhere]">{search}</span>”
                  </>
                ) : (
                  "Registered teams"
                )}{" "}
                <span className="tabular-nums">({result.total})</span>
              </h2>
              {search ? (
                <Link
                  href="/operator/teams"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-soft-foreground underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                >
                  Clear search
                </Link>
              ) : null}
            </div>
            {result.teams.length ? (
              <ul className="divide-y divide-separator overflow-hidden rounded-2xl bg-surface shadow-surface">
                {result.teams.map((team) => (
                  <TeamRow key={team.id} team={team} />
                ))}
              </ul>
            ) : result.total > 0 ? (
              <p className="text-muted">
                This page is past the end of the list.{" "}
                <Link
                  className="font-semibold text-accent-soft-foreground underline decoration-accent/40 underline-offset-4"
                  href={pageHref(search, 1)}
                >
                  Go to the first page
                </Link>
              </p>
            ) : search ? (
              <p className="text-muted">
                No teams match this search. Check the number, or search part of the name.
              </p>
            ) : (
              <p className="text-muted">
                No teams are registered yet. Teams appear here when you approve an access
                application.
              </p>
            )}
            {pages > 1 && result.teams.length ? (
              <nav
                aria-label="Team list pages"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <p className="text-sm text-muted tabular-nums">
                  {first}–{last} of {result.total}
                </p>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <LinkButton variant="outline" href={pageHref(search, page - 1)} rel="prev">
                      <ChevronLeft aria-hidden="true" className="size-4" />
                      Previous
                    </LinkButton>
                  ) : null}
                  {page < pages ? (
                    <LinkButton variant="outline" href={pageHref(search, page + 1)} rel="next">
                      Next
                      <ChevronRight aria-hidden="true" className="size-4" />
                    </LinkButton>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </section>
        )}
      </PageBody>
    </main>
  );
}
