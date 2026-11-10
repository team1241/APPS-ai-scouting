"use client";

import type { ContractIssue } from "@ai-scouting/scouting";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  publishSpecificationDraft,
  saveSpecificationDraft,
} from "@/app/admin/specification-actions";
import { adminHeading } from "@/components/page-heading";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  blankQuestion,
  dependencies,
  duplicateQuestion,
  type EditorIssue,
  type EditorQuestion,
  editorIssues,
  identityPolicies,
  kindLabels,
  serializeQuestions,
  toEditorQuestion,
  toEditorQuestions,
} from "@/lib/specification-model";
import {
  type Draft,
  dateTimeFormat,
  publicationPath,
  specificationsPath,
} from "@/lib/specifications";
import { cn } from "@/lib/utils";
import { DeleteDraftButton } from "./delete-draft-button";
import { controlClass, Field } from "./fields";
import { QuestionFields } from "./question-fields";
import { QuestionList } from "./question-list";

type SaveStatus =
  | { kind: "saved"; at: string }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; theirs: Draft }
  | { kind: "published"; version: string }
  | { kind: "missing" };

interface Content {
  name: string;
  description: string;
  questions: EditorQuestion[];
}

const AUTOSAVE_MS = 1500;

const statusView = (status: SaveStatus): [StatusTone, string] => {
  switch (status.kind) {
    case "saved":
      return ["success", `Saved ${dateTimeFormat.format(new Date(status.at)).split(", ").at(-1)}`];
    case "unsaved":
      return ["neutral", "Unsaved changes"];
    case "saving":
      return ["waiting", "Saving…"];
    case "error":
      return ["danger", "Not saved"];
    case "conflict":
      return ["warning", "Not saved: edited elsewhere"];
    case "published":
      return ["neutral", `Published as ${status.version}`];
    case "missing":
      return ["danger", "Draft deleted"];
  }
};

// Server issues only arrive on a refused publish; they are shown alongside the editor's own.
function serverIssueMessages(issues: ContractIssue[], questions: EditorQuestion[]) {
  return issues.map((issue) => {
    const index = issue.path[0] === "questions" ? issue.path[1] : undefined;
    const question = typeof index === "number" ? questions[index] : undefined;
    return {
      questionId: question?.id,
      field: "questions",
      message: question ? `${question.label || question.key}: ${issue.message}` : issue.message,
    } satisfies EditorIssue;
  });
}

export function DraftEditor({
  organizationId,
  draft,
  nextVersion,
}: {
  organizationId: string;
  draft: Draft;
  nextVersion: string;
}) {
  const router = useRouter();
  const kind = draft.kind;
  const [content, setContent] = useState<Content>(() => ({
    name: draft.name,
    description: draft.document.description,
    questions: toEditorQuestions(draft.document.questions),
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved", at: draft.updatedAt });
  const [announcement, setAnnouncement] = useState("");
  const [removing, setRemoving] = useState<EditorQuestion | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<EditorIssue[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const revision = useRef(draft.revision);
  const latest = useRef(content);
  latest.current = content;
  const edits = useRef(0);
  // The edit count the server last confirmed, so publishing knows whether to save first.
  const savedEdits = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked =
    status.kind === "conflict" || status.kind === "published" || status.kind === "missing";
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const issues = useMemo(
    () => [
      ...(content.name.trim()
        ? content.name.trim().length > 80
          ? [{ field: "name", message: "Use 80 characters or fewer for the name." }]
          : []
        : [{ field: "name", message: "Enter a name." }]),
      ...editorIssues(kind, content.description, content.questions),
      ...serverIssues,
    ],
    [kind, content, serverIssues],
  );
  const problemsByQuestion = useMemo(() => {
    const map = new Map<string, number>();
    for (const issue of issues)
      if (issue.questionId) map.set(issue.questionId, (map.get(issue.questionId) ?? 0) + 1);
    return map;
  }, [issues]);
  const fieldProblems = (questionId?: string) => {
    const map = new Map<string, string[]>();
    for (const issue of issues)
      if (issue.questionId === questionId)
        map.set(issue.field, [...(map.get(issue.field) ?? []), issue.message]);
    return map;
  };

  const save = useCallback(async (): Promise<void> => {
    if (blockedRef.current) return;
    if (saving.current) {
      await saving.current;
      return save();
    }
    const snapshot = latest.current;
    const sentEdits = edits.current;
    // The backend needs a name; keep the edits locally until there is one.
    if (!snapshot.name.trim() || snapshot.name.trim().length > 80) {
      setStatus({ kind: "error", message: "Enter a name of 80 characters or fewer to save." });
      return;
    }
    setStatus({ kind: "saving" });
    const run = (async () => {
      let result: Awaited<ReturnType<typeof saveSpecificationDraft>>;
      try {
        result = await saveSpecificationDraft(organizationId, draft.id, {
          revision: revision.current,
          name: snapshot.name.trim(),
          document: {
            description: snapshot.description,
            questions: serializeQuestions(snapshot.questions),
          },
        });
      } catch {
        result = {
          outcome: "error",
          message: "Your changes were not saved. They are kept here; try again.",
        };
      }
      if (result.outcome === "saved") {
        revision.current = result.draft.revision;
        savedEdits.current = sentEdits;
        if (edits.current === sentEdits) setStatus({ kind: "saved", at: result.draft.updatedAt });
        else setStatus({ kind: "unsaved" });
      } else if (result.outcome === "error") setStatus({ kind: "error", message: result.message });
      else {
        // Autosave stops until the admin resolves these.
        blockedRef.current = true;
        if (result.outcome === "conflict") setStatus({ kind: "conflict", theirs: result.draft });
        else if (result.outcome === "published")
          setStatus({ kind: "published", version: result.version });
        else setStatus({ kind: "missing" });
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [organizationId, draft.id]);

  // Saves after a pause in editing, and again if edits arrived during a save.
  useEffect(() => {
    if (status.kind !== "unsaved") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [status, save]);

  useEffect(() => {
    const dirty =
      status.kind !== "saved" && status.kind !== "published" && status.kind !== "missing";
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  const edit = useCallback((change: (current: Content) => Content) => {
    setContent((current) => change(current));
    setServerIssues([]);
    edits.current += 1;
    if (!blockedRef.current) setStatus({ kind: "unsaved" });
  }, []);
  const editQuestions = useCallback(
    (change: (questions: EditorQuestion[]) => EditorQuestion[]) =>
      edit((current) => ({ ...current, questions: change(current.questions) })),
    [edit],
  );

  const focusBlock = (id: string) =>
    requestAnimationFrame(() => {
      const block = document.getElementById(`block-${id}`);
      block?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      block?.querySelector<HTMLElement>("button[aria-expanded]")?.focus({ preventScroll: true });
    });

  const addQuestion = () => {
    const question = blankQuestion(content.questions);
    editQuestions((questions) => [...questions, question]);
    setSelectedId(question.id);
    requestAnimationFrame(() => {
      document.getElementById(`block-${question.id}`)?.scrollIntoView({ block: "start" });
      document.getElementById(`q-${question.id}-label`)?.focus({ preventScroll: true });
    });
  };
  const addIdentity = (key: "match" | "team_number", required: boolean) => {
    const template = toEditorQuestion(
      key === "match"
        ? {
            key: "match",
            label: "Match",
            prompt: "Which match was this?",
            guidance: "Match identifier as the scout stated it, for example Q12 or SF2-1.",
            required,
            answer: { type: "text" },
          }
        : {
            key: "team_number",
            label: "Team number",
            prompt: "Which team was this about?",
            guidance: "Positive FRC team number.",
            required,
            answer: { type: "number", format: "integer", min: 1 },
          },
    );
    editQuestions((questions) => [template, ...questions]);
    setSelectedId(template.id);
    setAnnouncement(`Added the ${template.label} identity question at the top.`);
  };
  const move = (question: EditorQuestion, by: -1 | 1) => {
    const index = content.questions.findIndex((q) => q.id === question.id);
    const target = index + by;
    if (target < 0 || target >= content.questions.length) return;
    editQuestions((questions) => {
      const next = [...questions];
      const [item] = next.splice(index, 1);
      if (item) next.splice(target, 0, item);
      return next;
    });
    setAnnouncement(
      `Moved ${question.label || "question"} to position ${target + 1} of ${content.questions.length}.`,
    );
    requestAnimationFrame(() =>
      document.getElementById(`move-${by < 0 ? "up" : "down"}-${question.id}`)?.focus(),
    );
  };
  const duplicate = (question: EditorQuestion) => {
    const copy = duplicateQuestion(question, content.questions);
    editQuestions((questions) => {
      const index = questions.findIndex((q) => q.id === question.id);
      return [...questions.slice(0, index + 1), copy, ...questions.slice(index + 1)];
    });
    setSelectedId(copy.id);
    focusBlock(copy.id);
    setAnnouncement(`Duplicated ${question.label || "question"}.`);
  };
  const remove = (question: EditorQuestion) => {
    const index = content.questions.findIndex((q) => q.id === question.id);
    editQuestions((questions) => questions.filter((q) => q.id !== question.id));
    setSelectedId(null);
    setRemoving(null);
    setAnnouncement(`Removed ${question.label || "question"}.`);
    const neighbour = content.questions[index + 1] ?? content.questions[index - 1];
    if (neighbour) focusBlock(neighbour.id);
  };
  const dependents = (question: EditorQuestion) =>
    dependencies(content.questions)
      .filter((d) => content.questions[d.from]?.id === question.id)
      .map((d) => content.questions[d.to])
      .filter((q): q is EditorQuestion => Boolean(q));

  const jumpTo = (issue: EditorIssue) => {
    setPublishOpen(false);
    if (issue.field === "name" || issue.field === "description") {
      document.getElementById(`draft-${issue.field}`)?.focus();
      return;
    }
    if (!issue.questionId) return;
    setSelectedId(issue.questionId);
    requestAnimationFrame(() => {
      const block = document.getElementById(`block-${issue.questionId}`);
      block?.scrollIntoView({ block: "start" });
      const target =
        block?.querySelector<HTMLElement>("[aria-invalid=true]") ??
        block?.querySelector<HTMLElement>("button[aria-expanded]");
      target?.focus({ preventScroll: true });
    });
  };

  const keepMine = () => {
    if (status.kind !== "conflict") return;
    revision.current = status.theirs.revision;
    setStatus({ kind: "unsaved" });
    blockedRef.current = false;
    void save();
  };
  const loadTheirs = () => {
    if (status.kind !== "conflict") return;
    const theirs = status.theirs;
    revision.current = theirs.revision;
    savedEdits.current = edits.current;
    setContent({
      name: theirs.name,
      description: theirs.document.description,
      questions: toEditorQuestions(theirs.document.questions),
    });
    setSelectedId(null);
    blockedRef.current = false;
    setStatus({ kind: "saved", at: theirs.updatedAt });
  };

  const publish = async () => {
    setPublishError(null);
    setPublishing(true);
    try {
      if (edits.current !== savedEdits.current) await save();
      if (blockedRef.current) return;
      if (edits.current !== savedEdits.current) {
        setPublishError("Your latest changes are not saved yet. Save them, then publish.");
        return;
      }
      const result = await publishSpecificationDraft(organizationId, draft.id, revision.current);
      if (result.outcome === "published") {
        const { season, kind: k, version } = result.publication;
        setStatus({ kind: "published", version });
        router.push(`${publicationPath(organizationId, season, k, version)}?published=1`);
        return;
      }
      if (result.outcome === "invalid")
        setServerIssues(serverIssueMessages(result.issues, latest.current.questions));
      else if (result.outcome === "conflict") {
        blockedRef.current = true;
        setStatus({ kind: "conflict", theirs: result.draft });
        setPublishOpen(false);
      } else setPublishError(result.message);
    } catch {
      setPublishError("The specification was not published. Try again shortly.");
    } finally {
      setPublishing(false);
    }
  };

  const [tone, label] = statusView(status);
  const readOnly = status.kind === "published" || status.kind === "missing";
  const identities = identityPolicies(kind);
  const missingIdentity = identities.filter(
    (p) => p.policy !== "excluded" && !content.questions.some((q) => q.key === p.key),
  );
  const summary = issues.slice(0, 50);
  const issueContext = (issue: EditorIssue) => {
    const index = content.questions.findIndex((q) => q.id === issue.questionId);
    const question = content.questions[index];
    return question ? (
      <span className="font-medium">
        {index + 1}. {question.label || question.key || "Untitled"}:{" "}
      </span>
    ) : null;
  };

  return (
    <div className="pb-40">
      <div className="mx-auto max-w-[60rem] space-y-6 px-4 pt-10 sm:px-6">
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
          <span className="tabular-nums">{draft.season}</span>
          <span aria-hidden="true" className="px-2">
            /
          </span>
          <span>{kindLabels[kind]}</span>
        </nav>
        <div className="space-y-3">
          <h1 className={cn(adminHeading, "[overflow-wrap:anywhere]")}>
            {content.name.trim() || "Untitled draft"}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground">
            <StatusBadge tone="waiting">Draft</StatusBadge>
            <span>
              {draft.season} {kindLabels[kind].toLowerCase()} scouting
              {draft.source ? ` · copied from ${draft.source.season} ${draft.source.version}` : ""}
              {" · "}publishes as {nextVersion}
            </span>
          </p>
        </div>

        {status.kind === "conflict" ? (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-warning/40 bg-warning-soft p-5"
          >
            <p className="font-semibold text-warning">Someone else saved this draft</p>
            <p className="text-sm">
              Their version was saved {dateTimeFormat.format(new Date(status.theirs.updatedAt))} and
              has {status.theirs.document.questions.length} questions. Yours has{" "}
              {content.questions.length} and is not saved yet. Keep one of them; the other is
              replaced.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="h-11" onClick={keepMine}>
                Keep my version
              </Button>
              <Button type="button" variant="outline" className="h-11" onClick={loadTheirs}>
                Load their version
              </Button>
            </div>
          </div>
        ) : null}
        {status.kind === "published" ? (
          <div role="status" className="rounded-xl border bg-card p-5">
            <p className="font-semibold">This draft was published as {status.version}.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Published versions cannot change. Open it to create a new draft from it.
            </p>
            <Link
              href={publicationPath(organizationId, draft.season, kind, status.version)}
              className="mt-3 inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Open {status.version}
            </Link>
          </div>
        ) : null}
        {status.kind === "missing" ? (
          <div role="alert" className="rounded-xl border bg-card p-5">
            <p className="font-semibold">This draft no longer exists.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Another admin deleted it. Your changes on this page were not saved.
            </p>
            <Link
              href={specificationsPath(organizationId)}
              className="mt-3 inline-block text-primary underline"
            >
              Back to specifications
            </Link>
          </div>
        ) : null}

        <fieldset disabled={readOnly} className="space-y-6">
          <legend className="sr-only">Draft details</legend>
          <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <Field
              id="draft-name"
              label="Name"
              errors={issues.filter((i) => i.field === "name").map((i) => i.message)}
            >
              {(props) => (
                <input
                  {...props}
                  className={`${controlClass} h-11`}
                  value={content.name}
                  onChange={(e) => edit((c) => ({ ...c, name: e.target.value }))}
                />
              )}
            </Field>
            <Field
              id="draft-description"
              label="Description"
              hint="For admins. Scouts do not see it."
              errors={issues.filter((i) => i.field === "description").map((i) => i.message)}
            >
              {(props) => (
                <textarea
                  {...props}
                  rows={2}
                  className={`${controlClass} min-h-11 py-2.5`}
                  value={content.description}
                  onChange={(e) => edit((c) => ({ ...c, description: e.target.value }))}
                />
              )}
            </Field>
          </div>

          <details className="group rounded-xl border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              <span>Identity for {kindLabels[kind].toLowerCase()} scouting</span>
              <span className="text-primary group-open:hidden">Show</span>
              <span className="hidden text-primary group-open:inline">Hide</span>
            </summary>
            <div className="space-y-3 border-t px-5 py-4 text-sm">
              <p className="text-muted-foreground">
                Identity questions say which match and team an observation is about. They are always
                asked, and their codes and answer types are fixed. The event always comes from the
                scouting session.
              </p>
              <ul className="space-y-2">
                {identities.map((p) => (
                  <li key={p.key}>
                    <span className="font-medium">{p.label}</span>{" "}
                    <code className="font-mono text-[0.8125rem] text-muted-foreground">
                      {p.key}
                    </code>
                    {": "}
                    {p.explanation}
                  </li>
                ))}
              </ul>
              {missingIdentity.length ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {missingIdentity.map((p) => (
                    <Button
                      key={p.key}
                      type="button"
                      variant="outline"
                      className="h-11"
                      onClick={() => addIdentity(p.key, p.policy === "required")}
                    >
                      <Plus aria-hidden="true" />
                      Add {p.label.toLowerCase()} question
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </details>
        </fieldset>

        {issues.length ? (
          <section
            aria-labelledby="problem-summary"
            className="rounded-xl border border-destructive/30 bg-destructive-soft/60 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="problem-summary"
                className="flex items-center gap-2 font-semibold text-destructive"
              >
                <AlertTriangle aria-hidden="true" className="size-4" />
                {issues.length === 1
                  ? "1 problem to fix before publishing"
                  : `${issues.length} problems to fix before publishing`}
              </h2>
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                aria-expanded={summaryOpen}
                aria-controls="problem-list"
                onClick={() => setSummaryOpen(!summaryOpen)}
              >
                {summaryOpen ? "Hide list" : "Show list"}
              </Button>
            </div>
            <p className="mt-1 text-sm">Drafts save with problems. Publishing needs none.</p>
            {summaryOpen ? (
              <ul id="problem-list" className="mt-3 space-y-1">
                {summary.map((issue, index) => {
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: issues have no identity and are recomputed on each edit.
                    <li key={index}>
                      <button
                        type="button"
                        onClick={() => jumpTo(issue)}
                        className="min-h-9 text-left text-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {issueContext(issue)}
                        {issue.message}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="questions-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="questions-title" className="text-lg font-semibold">
              Questions{" "}
              <span className="font-normal text-muted-foreground tabular-nums">
                ({content.questions.length})
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">
              In the order scouts are asked. Lines link questions that depend on an earlier answer.
            </p>
          </div>
          {content.questions.length ? (
            <fieldset disabled={readOnly}>
              <legend className="sr-only">Questions</legend>
              <QuestionList
                kind={kind}
                questions={content.questions}
                selectedId={selectedId}
                onSelect={setSelectedId}
                problems={problemsByQuestion}
                renderBody={(question, index) => (
                  <div className="space-y-6">
                    <div className="flex flex-wrap gap-1 border-b pb-4">
                      <Button
                        id={`move-up-${question.id}`}
                        type="button"
                        variant="ghost"
                        className="h-11"
                        disabled={index === 0}
                        onClick={() => move(question, -1)}
                      >
                        <ArrowUp aria-hidden="true" />
                        Move up
                      </Button>
                      <Button
                        id={`move-down-${question.id}`}
                        type="button"
                        variant="ghost"
                        className="h-11"
                        disabled={index === content.questions.length - 1}
                        onClick={() => move(question, 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                        Move down
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11"
                        onClick={() => duplicate(question)}
                      >
                        <Copy aria-hidden="true" />
                        Duplicate
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 text-destructive hover:text-destructive"
                        disabled={
                          identities.find((p) => p.key === question.key)?.policy === "required"
                        }
                        onClick={() => setRemoving(question)}
                      >
                        <Trash2 aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                    <QuestionFields
                      question={question}
                      questions={content.questions}
                      kind={kind}
                      problems={fieldProblems(question.id)}
                      onQuestionsChange={editQuestions}
                    />
                  </div>
                )}
              />
            </fieldset>
          ) : (
            <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center">
              <p className="font-medium">No questions yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add the first thing scouts should report. Each question needs a follow-up for when
                the answer is missing.
              </p>
              {!readOnly ? (
                <Button type="button" className="mt-4 h-11" onClick={addQuestion}>
                  <Plus aria-hidden="true" />
                  Add question
                </Button>
              ) : null}
            </div>
          )}
          {!readOnly ? (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              {content.questions.length ? (
                <Button type="button" variant="outline" className="h-11" onClick={addQuestion}>
                  <Plus aria-hidden="true" />
                  Add question
                </Button>
              ) : null}
              <DeleteDraftButton
                organizationId={organizationId}
                draftId={draft.id}
                name={content.name || draft.name}
                redirectToList
              />
            </div>
          ) : null}
        </section>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* The action bar stays in reach while the list scrolls. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur-sm supports-[backdrop-filter]:bg-card/85">
        <div className="mx-auto flex max-w-[60rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <span role="status" aria-live="polite" className="flex items-center gap-2">
            <StatusBadge tone={tone}>{label}</StatusBadge>
          </span>
          {status.kind === "error" ? (
            <span className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              {status.message}
              <Button type="button" variant="outline" className="h-9" onClick={() => void save()}>
                Try again
              </Button>
            </span>
          ) : status.kind === "unsaved" ? (
            <Button
              type="button"
              variant="ghost"
              className="h-9 max-sm:hidden"
              onClick={() => void save()}
            >
              Save now
            </Button>
          ) : null}
          {issues.length ? (
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-full bg-destructive-soft px-3 text-sm font-medium text-destructive"
              onClick={() => {
                setSummaryOpen(true);
                document.getElementById("problem-summary")?.scrollIntoView({ block: "center" });
              }}
            >
              {issues.length === 1 ? "1 problem" : `${issues.length} problems`}
            </button>
          ) : null}
          <span className="flex-1" />
          {!readOnly ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-11 max-sm:hidden"
                onClick={addQuestion}
              >
                <Plus aria-hidden="true" />
                Add question
              </Button>
              <Button
                type="button"
                className="h-11 px-5 max-sm:w-full"
                disabled={status.kind === "conflict"}
                onClick={() => {
                  setPublishError(null);
                  setPublishOpen(true);
                }}
              >
                Review and publish
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? null : setRemoving(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove “{removing?.label || removing?.key || "this question"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing && dependents(removing).length
                ? `Rules on ${dependents(removing)
                    .map((q) => `“${q.label || q.key}”`)
                    .join(", ")} use its answer. Those rules will need fixing before you publish.`
                : "The question and its rules are removed from this draft."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline" className="h-11">
                Keep question
              </Button>
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              onClick={() => removing && remove(removing)}
            >
              Remove question
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={publishOpen}
        onOpenChange={(open) => (publishing ? null : setPublishOpen(open))}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
          {issues.length ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {issues.length === 1
                    ? "Fix 1 problem before publishing"
                    : `Fix ${issues.length} problems before publishing`}
                </DialogTitle>
                <DialogDescription>
                  Select a problem to go to it. Your draft is kept.
                </DialogDescription>
              </DialogHeader>
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {summary.map((issue, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: issues have no identity.
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => jumpTo(issue)}
                      className="min-h-9 text-left text-sm text-destructive underline-offset-4 hover:underline"
                    >
                      {issueContext(issue)}
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" className="h-11">
                    Back to editing
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Publish “{content.name.trim()}”?</DialogTitle>
                <DialogDescription>
                  A published version cannot be edited. To change it later, create a new draft from
                  it.
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border text-center">
                {[
                  ["Season", String(draft.season)],
                  ["Kind", kindLabels[kind]],
                  ["Version", nextVersion],
                ].map(([term, value]) => (
                  <div key={term} className="bg-card px-3 py-3">
                    <dt className="text-xs text-muted-foreground">{term}</dt>
                    <dd className="font-extrabold font-stretch-125% text-xl text-navy tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm">
                {content.questions.length} questions. Publishing does not change any event. Next,
                you choose which events use it for new scouting sessions.
              </p>
              {publishError ? (
                <p role="alert" className="text-sm text-destructive">
                  {publishError}
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={publishing} className="h-11">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="button" disabled={publishing} className="h-11 px-5" onClick={publish}>
                  {publishing ? "Publishing…" : `Publish ${nextVersion}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
