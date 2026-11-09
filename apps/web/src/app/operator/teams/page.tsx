import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationsUnavailable } from "@/components/operator-applications";
import { PageHeading, TeamNumber } from "@/components/page-heading";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type DirectoryTeam, directoryPage, operatorAccess } from "@/lib/operator";

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
        className="flex items-start gap-4 p-5 outline-none sm:gap-5 sm:p-6 hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <TeamNumber
          value={team.teamNumber}
          className="w-16 shrink-0 text-xl leading-8 sm:w-24 sm:text-2xl"
        />
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <p className="font-semibold leading-8">{team.name}</p>
          <p className="text-sm text-muted-foreground">
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
        <ChevronRight aria-hidden="true" className="mt-2 size-5 shrink-0 text-muted-foreground" />
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
    <main id="main" className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <PageHeading description="Every registered team on the platform. Only operators see this list. Opening a team does not make you one of its admins.">
        All teams
      </PageHeading>
      <search>
        <form action="/operator/teams" className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="team-search">Team number or name</Label>
            <Input
              id="team-search"
              name="q"
              type="search"
              defaultValue={search}
              maxLength={120}
              autoComplete="off"
              className="h-11"
            />
          </div>
          <Button type="submit" variant="outline" className="h-11 px-5">
            <Search aria-hidden="true" />
            Search
          </Button>
        </form>
      </search>
      {access === null || result === null ? (
        <ApplicationsUnavailable href={pageHref(search, page)} />
      ) : (
        <section aria-labelledby="teams-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="teams-heading" className="text-lg font-semibold">
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
                className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
              >
                Clear search
              </Link>
            ) : null}
          </div>
          {result.teams.length ? (
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {result.teams.map((team) => (
                <TeamRow key={team.id} team={team} />
              ))}
            </ul>
          ) : result.total > 0 ? (
            <p className="text-muted-foreground">
              This page is past the end of the list.{" "}
              <Link
                className="text-primary underline underline-offset-4"
                href={pageHref(search, 1)}
              >
                Go to the first page
              </Link>
            </p>
          ) : search ? (
            <p className="text-muted-foreground">
              No teams match this search. Check the number, or search part of the name.
            </p>
          ) : (
            <p className="text-muted-foreground">
              No teams are registered yet. Teams appear here when you approve an access application.
            </p>
          )}
          {pages > 1 && result.teams.length ? (
            <nav
              aria-label="Team list pages"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <p className="text-sm text-muted-foreground tabular-nums">
                {first}–{last} of {result.total}
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Button asChild variant="outline" className="h-11">
                    <Link href={pageHref(search, page - 1)} rel="prev">
                      <ChevronLeft aria-hidden="true" />
                      Previous
                    </Link>
                  </Button>
                ) : null}
                {page < pages ? (
                  <Button asChild variant="outline" className="h-11">
                    <Link href={pageHref(search, page + 1)} rel="next">
                      Next
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
      )}
    </main>
  );
}
