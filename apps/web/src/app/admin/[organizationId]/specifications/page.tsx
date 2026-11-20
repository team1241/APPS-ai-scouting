import type { ObservationKind } from "@ai-scouting/scouting";
import { ChevronRight, ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { LinkButton } from "@/components/link-button";
import { PageBody, PageHeading } from "@/components/page-heading";
import { DeleteDraftButton } from "@/components/specifications/delete-draft-button";
import { NewSpecificationDialog } from "@/components/specifications/new-specification-dialog";
import { StatusBadge } from "@/components/status-badge";
import { TeamNavigation } from "@/components/team-navigation";
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
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={draftPath(organizationId, draft.id)}
            className="rounded-sm font-semibold [overflow-wrap:anywhere] underline-offset-4 hover:underline"
          >
            {draft.name}
          </Link>
          <StatusBadge tone="waiting">Draft</StatusBadge>
        </p>
        <p className="mt-1 text-sm text-muted">
          Edited{" "}
          <time dateTime={draft.updatedAt}>{dateTimeFormat.format(new Date(draft.updatedAt))}</time>
          {draft.source ? ` · copied from ${draft.source.season} ${draft.source.version}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <LinkButton href={draftPath(organizationId, draft.id)} variant="outline">
          Continue editing
        </LinkButton>
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
        className="group flex items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-secondary focus-visible:outline-offset-[-3px] motion-reduce:transition-none sm:gap-4 sm:px-6"
      >
        <span className="font-bumper w-12 shrink-0 text-xl text-accent">
          {numbered ? publication.version : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold [overflow-wrap:anywhere]">
            {publication.name ??
              (publication.formatVersion === 1 ? "Starter questions" : publication.version)}
          </span>
          <span className="block text-sm text-muted [overflow-wrap:anywhere]">
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
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
        />
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
          <Plus aria-hidden="true" className="size-4" />
          New specification
        </>
      }
    />
  ) : null;
  const newOnBand = list ? (
    <NewSpecificationDialog
      organizationId={organizationId}
      defaults={{ season: seasons[0] && seasons[0] > season ? seasons[0] : season }}
      publications={list.publications}
      variant="field"
      trigger={
        <>
          <Plus aria-hidden="true" className="size-4" />
          New specification
        </>
      }
    />
  ) : null;
  return (
    <>
      <TeamNavigation organization={organization} canChangeTeam={organizations.length > 1} />
      <main id="main">
        <PageHeading
          description="What the bot collects from scouts for each kind of observation. Edit a draft, publish it as a version, then choose that version for an event."
          actions={seasons.length ? newOnBand : null}
        >
          Scouting specifications
        </PageHeading>
        <PageBody className="space-y-10">
          {!list ? (
            <div className="rounded-2xl bg-surface p-5 shadow-surface sm:p-6">
              <StatusBadge tone="warning">Unavailable</StatusBadge>
              <p className="mt-3">
                We couldn’t load this team’s specifications. Try again shortly.
              </p>
              <LinkButton
                href={`/admin/${organizationId}/specifications`}
                variant="outline"
                className="mt-4"
              >
                Check again
              </LinkButton>
            </div>
          ) : !seasons.length ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface px-6 py-12 text-center shadow-surface">
              <span
                aria-hidden="true"
                className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground"
              >
                <ClipboardList className="size-6" />
              </span>
              <div className="max-w-md space-y-1.5">
                <h2 className="text-lg font-semibold">No specifications yet</h2>
                <p className="text-sm text-pretty text-muted">
                  Start from example questions for match, pit or general scouting, or from just the
                  identity questions. Drafts change nothing for scouts until you publish one.
                </p>
              </div>
              {newDialog}
            </div>
          ) : (
            seasons.map((year) => (
              <section key={year} aria-labelledby={`season-${year}`} className="space-y-4">
                <h2 id={`season-${year}`} className="font-bumper text-2xl text-foreground">
                  {year} season
                </h2>
                {observationKindOrder.map((kind: ObservationKind) => {
                  const drafts = list.drafts.filter((d) => d.season === year && d.kind === kind);
                  const publications = list.publications.filter(
                    (p) => p.season === year && p.kind === kind,
                  );
                  if (!drafts.length && !publications.length) return null;
                  return (
                    <div
                      key={kind}
                      className="overflow-hidden rounded-2xl bg-surface shadow-surface"
                    >
                      <h3 className="border-b border-separator bg-surface-secondary px-5 py-3 text-sm font-semibold sm:px-6">
                        {kindLabels[kind]} scouting
                      </h3>
                      <ul className="divide-y divide-separator">
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
        </PageBody>
      </main>
    </>
  );
}
