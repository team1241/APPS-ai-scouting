import { type ObservationKind, observationKinds } from "@ai-scouting/scouting";
import { CheckCircle2, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminHeading, PageHeading } from "@/components/page-heading";
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
import { cn } from "@/lib/utils";

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
        <main id="main" className="mx-auto max-w-3xl space-y-4 px-6 py-12">
          <PageHeading>{missing ? "Version not found" : "This version is unavailable"}</PageHeading>
          <p>
            {missing
              ? "This team has no such published version."
              : "We couldn’t load it. Try again shortly."}
          </p>
          <Link className="text-primary underline" href={specificationsPath(organizationId)}>
            Back to specifications
          </Link>
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
      <main id="main" className="mx-auto max-w-[60rem] space-y-8 px-4 py-10 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link
            href={specificationsPath(organizationId)}
            className="text-primary underline underline-offset-4"
          >
            Scouting specifications
          </Link>
          <span aria-hidden="true" className="px-2">
            /
          </span>
          <span className="tabular-nums">{season}</span>
          <span aria-hidden="true" className="px-2">
            /
          </span>
          <span>{kindLabels[kind]}</span>
        </nav>
        {published ? (
          <div
            role="status"
            className="flex gap-3 rounded-xl border border-success/30 bg-success-soft p-5"
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
            <div>
              <p className="font-semibold text-success">
                Published {version} for {season} {kindLabels[kind].toLowerCase()} scouting.
              </p>
              <p className="mt-1 text-sm">
                No event uses it yet. Choose events below to use it for new sessions.
              </p>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1 basis-80 space-y-3">
            <h1 className={cn(adminHeading, "[overflow-wrap:anywhere]")}>
              <span className="text-primary tabular-nums">{version}</span> {name}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground">
              <StatusBadge tone="neutral">
                <Lock aria-hidden="true" className="-ml-1 size-3.5" />
                Published, read-only
              </StatusBadge>
              <span>
                {season} {kindLabels[kind].toLowerCase()} scouting · published{" "}
                <time dateTime={publication.publishedAt}>
                  {dateFormat.format(new Date(publication.publishedAt))}
                </time>
              </span>
            </p>
          </div>
          <NewSpecificationDialog
            organizationId={organizationId}
            title="Create an editable draft"
            trigger="Create editable draft"
            publications={publications}
            defaults={{
              season: Math.max(season, defaultSeason()),
              kind,
              name: `${name} (draft)`.slice(0, 80),
              source: `publication:${season}:${version}`,
              fixedSource: { label: `${season} ${version}` },
            }}
          />
        </div>
        {publication.contract.description ? (
          <p className="max-w-prose text-muted-foreground">{publication.contract.description}</p>
        ) : null}
        <EventAssignmentList
          organizationId={organizationId}
          kind={kind}
          season={season}
          version={version}
          events={events}
        />
        <section aria-labelledby="questions-title" className="space-y-3">
          <h2 id="questions-title" className="text-lg font-semibold">
            Questions{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              ({publication.contract.questions.length})
            </span>
          </h2>
          <PublishedQuestions kind={kind} questions={publication.contract.questions} />
        </section>
      </main>
    </>
  );
}
