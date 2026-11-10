import type { ObservationKind } from "@ai-scouting/scouting";
import { ChevronRight, ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { DeleteDraftButton } from "@/components/specifications/delete-draft-button";
import { NewSpecificationDialog } from "@/components/specifications/new-specification-dialog";
import { StatusBadge } from "@/components/status-badge";
import { TeamNavigation } from "@/components/team-navigation";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { backendRequest } from "@/lib/backend";
import { kindLabels } from "@/lib/specification-model";
import {
  type DraftSummary,
  dateFormat,
  dateTimeFormat,
  defaultSeason,
  draftPath,
  type EventAssignments,
  observationKindOrder,
  type PublicationSummary,
  publicationPath,
} from "@/lib/specifications";
import { teamAccess } from "@/lib/team-access";

export const metadata = { title: "Scouting specifications" };

function DraftRow({ organizationId, draft }: { organizationId: string; draft: DraftSummary }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={draftPath(organizationId, draft.id)}
            className="font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline"
          >
            {draft.name}
          </Link>
          <StatusBadge tone="waiting">Draft</StatusBadge>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Edited{" "}
          <time dateTime={draft.updatedAt}>{dateTimeFormat.format(new Date(draft.updatedAt))}</time>
          {draft.source ? ` · copied from ${draft.source.season} ${draft.source.version}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Link
          href={draftPath(organizationId, draft.id)}
          className="inline-flex h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
        >
          Continue editing
        </Link>
        <DeleteDraftButton organizationId={organizationId} draftId={draft.id} name={draft.name} />
      </div>
    </li>
  );
}

function PublicationRow({
  organizationId,
  publication,
  events,
}: {
  organizationId: string;
  publication: PublicationSummary;
  events: Map<string, string>;
}) {
  const used = publication.assignedEventIds
    .map((id) => events.get(id))
    .filter((name): name is string => Boolean(name));
  const numbered = /^v\d+$/.test(publication.version);
  const badge = used.length ? (
    <StatusBadge tone="success">
      {used.length === 1 ? "Used at 1 event" : `Used at ${used.length} events`}
    </StatusBadge>
  ) : null;
  const href = publicationPath(
    organizationId,
    publication.season,
    publication.kind,
    publication.version,
  );
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-4 outline-none hover:bg-accent/60 sm:gap-4 sm:px-5 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="w-12 shrink-0 font-extrabold font-stretch-125% text-lg text-primary tabular-nums">
          {numbered ? publication.version : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium [overflow-wrap:anywhere]">
            {publication.name ??
              (publication.formatVersion === 1 ? "Starter questions" : publication.version)}
          </span>
          <span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {numbered ? null : (
              <code className="font-mono text-[0.8125rem]">{publication.version} · </code>
            )}
            Published{" "}
            <time dateTime={publication.publishedAt}>
              {dateFormat.format(new Date(publication.publishedAt))}
            </time>
            {used.length ? ` · ${used.join(", ")}` : ""}
          </span>
          {badge ? <span className="mt-2 block sm:hidden">{badge}</span> : null}
        </span>
        {badge ? <span className="max-sm:hidden">{badge}</span> : null}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

export default async function SpecificationsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const base = `/web/organizations/${organizationId}/specifications`;
  const [access, listResponse, eventsResponse] = await Promise.all([
    teamAccess(organizationId),
    backendRequest(base),
    backendRequest(`${base}/events`),
  ]);
  if (!access.ok) return access.page;
  const { organization, organizations } = access;
  const list = listResponse?.ok
    ? ((await listResponse.json()) as {
        drafts: DraftSummary[];
        publications: PublicationSummary[];
      })
    : null;
  const events = eventsResponse?.ok
    ? ((await eventsResponse.json()) as { events: EventAssignments[] }).events
    : [];
  const eventNames = new Map(events.map((e) => [e.event.id, e.event.name]));
  const seasons = list
    ? [...new Set([...list.drafts, ...list.publications].map((s) => s.season))].sort(
        (a, b) => b - a,
      )
    : [];
  const season = defaultSeason();
  const newDialog = list ? (
    <NewSpecificationDialog
      organizationId={organizationId}
      defaults={{ season: seasons[0] && seasons[0] > season ? seasons[0] : season }}
      publications={list.publications}
      trigger={
        <>
          <Plus aria-hidden="true" />
          New specification
        </>
      }
    />
  ) : null;
  return (
    <>
      <TeamNavigation organization={organization} canChangeTeam={organizations.length > 1} />
      <main id="main" className="mx-auto max-w-4xl space-y-10 px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <PageHeading
            className="flex-1 basis-80"
            description="What the bot collects from scouts for each kind of observation. Edit a draft, publish it as a version, then choose that version for an event."
          >
            Scouting specifications
          </PageHeading>
          {seasons.length ? newDialog : null}
        </div>
        {!list ? (
          <div className="rounded-xl border bg-card p-6">
            <StatusBadge tone="warning">Unavailable</StatusBadge>
            <p className="mt-3">We couldn’t load this team’s specifications. Try again shortly.</p>
            <Link
              href={`/admin/${organizationId}/specifications`}
              className="mt-4 inline-flex h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
            >
              Check again
            </Link>
          </div>
        ) : !seasons.length ? (
          <Empty className="rounded-xl border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardList aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No specifications yet</EmptyTitle>
              <EmptyDescription>
                Start from example questions for match, pit or general scouting, or from just the
                identity questions. Drafts change nothing for scouts until you publish one.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{newDialog}</EmptyContent>
          </Empty>
        ) : (
          seasons.map((year) => (
            <section key={year} aria-labelledby={`season-${year}`} className="space-y-4">
              <h2
                id={`season-${year}`}
                className="font-extrabold font-stretch-125% text-2xl text-navy tabular-nums"
              >
                {year} season
              </h2>
              {observationKindOrder.map((kind: ObservationKind) => {
                const drafts = list.drafts.filter((d) => d.season === year && d.kind === kind);
                const publications = list.publications.filter(
                  (p) => p.season === year && p.kind === kind,
                );
                if (!drafts.length && !publications.length) return null;
                return (
                  <div key={kind} className="overflow-hidden rounded-xl border bg-card">
                    <h3 className="border-b bg-muted/40 px-5 py-3 text-sm font-semibold">
                      {kindLabels[kind]} scouting
                    </h3>
                    <ul className="divide-y">
                      {drafts.map((draft) => (
                        <DraftRow key={draft.id} organizationId={organizationId} draft={draft} />
                      ))}
                      {publications.map((publication) => (
                        <PublicationRow
                          key={publication.version}
                          organizationId={organizationId}
                          publication={publication}
                          events={eventNames}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </main>
    </>
  );
}
