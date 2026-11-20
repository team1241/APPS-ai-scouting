import { type ObservationKind, observationKinds } from "@ai-scouting/scouting";
import { ArrowLeft, CheckCircle2, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/link-button";
import { PageBody, PageHeading } from "@/components/page-heading";
import { EventAssignmentList } from "@/components/specifications/event-assignments";
import { NewSpecificationDialog } from "@/components/specifications/new-specification-dialog";
import { PublishedQuestions } from "@/components/specifications/question-details";
import { StatusBadge } from "@/components/status-badge";
import { TeamNavigation } from "@/components/team-navigation";
import { backendRequest } from "@/lib/backend";
import { kindLabels } from "@/lib/specification-model";
import {
  dateFormat,
  defaultSeason,
  type EventAssignments,
  type Publication,
  type PublicationSummary,
  specificationsPath,
} from "@/lib/specifications";
import { teamAccess } from "@/lib/team-access";

export const metadata = { title: "Published specification" };

export default async function PublicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; season: string; kind: string; version: string }>;
  searchParams: Promise<{ published?: string }>;
}) {
  const { organizationId, season: seasonText, kind: kindText, version: rawVersion } = await params;
  const { published } = await searchParams;
  const version = decodeURIComponent(rawVersion);
  if (!(observationKinds as readonly string[]).includes(kindText) || !/^\d{4}$/.test(seasonText))
    notFound();
  const kind = kindText as ObservationKind;
  const season = Number(seasonText);
  const base = `/web/organizations/${organizationId}/specifications`;
  const [access, publicationResponse, listResponse, eventsResponse] = await Promise.all([
    teamAccess(organizationId),
    backendRequest(`${base}/publications/${season}/${kind}/${encodeURIComponent(version)}`),
    backendRequest(base),
    backendRequest(`${base}/events`),
  ]);
  if (!access.ok) return access.page;
  const navigation = (
    <TeamNavigation
      organization={access.organization}
      canChangeTeam={access.organizations.length > 1}
    />
  );
  if (!publicationResponse?.ok) {
    const missing = publicationResponse?.status === 404;
    return (
      <>
        {navigation}
        <main id="main">
          <PageHeading
            description={
              missing
                ? "This team has no such published version."
                : "We couldn’t load it. Try again shortly."
            }
          >
            {missing ? "Version not found" : "This version is unavailable"}
          </PageHeading>
          <PageBody>
            <LinkButton href={specificationsPath(organizationId)} variant="outline">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to specifications
            </LinkButton>
          </PageBody>
        </main>
      </>
    );
  }
  const { publication } = (await publicationResponse.json()) as { publication: Publication };
  const publications = listResponse?.ok
    ? ((await listResponse.json()) as { publications: PublicationSummary[] }).publications
    : [publication];
  const events = eventsResponse?.ok
    ? ((await eventsResponse.json()) as { events: EventAssignments[] }).events.filter(
        (e) => e.event.season === season,
      )
    : null;
  const name =
    publication.name ?? (publication.formatVersion === 1 ? "Starter questions" : version);
  return (
    <>
      {navigation}
      <main id="main">
        <PageHeading
          before={
            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap items-center text-sm font-medium text-bumper-ink"
            >
              <Link
                href={specificationsPath(organizationId)}
                className="inline-flex min-h-11 items-center rounded-full px-3 underline decoration-white/40 underline-offset-4 hover:bg-white/10 hover:text-white"
              >
                Scouting specifications
              </Link>
              <ChevronRight aria-hidden="true" className="size-4 opacity-60" />
              <span className="px-2 tabular-nums">{season}</span>
              <ChevronRight aria-hidden="true" className="size-4 opacity-60" />
              <span className="px-2">{kindLabels[kind]}</span>
            </nav>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusBadge tone="neutral" className="bg-white/15 text-white">
                <Lock aria-hidden="true" className="-ml-1 size-3.5" />
                Published, read-only
              </StatusBadge>
              <span>
                {season} {kindLabels[kind].toLowerCase()} scouting · published{" "}
                <time dateTime={publication.publishedAt}>
                  {dateFormat.format(new Date(publication.publishedAt))}
                </time>
              </span>
            </span>
          }
          actions={
            <NewSpecificationDialog
              organizationId={organizationId}
              title="Create an editable draft"
              trigger="Create editable draft"
              variant="field"
              publications={publications}
              defaults={{
                season: Math.max(season, defaultSeason()),
                kind,
                name: `${name} (draft)`.slice(0, 80),
                source: `publication:${season}:${version}`,
                fixedSource: { label: `${season} ${version}` },
              }}
            />
          }
        >
          <span className="font-bumper text-sky">{version}</span> {name}
        </PageHeading>
        <PageBody className="space-y-8">
          {published ? (
            <div role="status" className="flex gap-3 rounded-2xl bg-success-soft p-5">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-success-soft-foreground"
              />
              <div>
                <p className="font-semibold text-success-soft-foreground">
                  Published {version} for {season} {kindLabels[kind].toLowerCase()} scouting.
                </p>
                <p className="mt-1 text-sm">
                  No event uses it yet. Choose events below to use it for new sessions.
                </p>
              </div>
            </div>
          ) : null}
          {publication.contract.description ? (
            <p className="max-w-prose text-muted">{publication.contract.description}</p>
          ) : null}
          <EventAssignmentList
            organizationId={organizationId}
            kind={kind}
            season={season}
            version={version}
            events={events}
          />
          <section aria-labelledby="questions-title" className="space-y-3">
            <h2 id="questions-title" className="font-display text-xl">
              Questions{" "}
              <span className="font-sans font-medium text-muted tabular-nums">
                ({publication.contract.questions.length})
              </span>
            </h2>
            <PublishedQuestions kind={kind} questions={publication.contract.questions} />
          </section>
        </PageBody>
      </main>
    </>
  );
}
