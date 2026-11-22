"use client";

import type { ContractIssue } from "@ai-scouting/scouting";
import { AlertDialog, Button, Input, TextArea } from "@heroui/react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DraftTestMessage,
  publishSpecificationDraft,
  saveSpecificationDraft,
  testSpecificationDraft,
} from "@/app/admin/specification-actions";
import { DialogActions, FormDialog } from "@/components/form-dialog";
import { LinkButton } from "@/components/link-button";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import {
  blankQuestion,
  dependencies,
  duplicateQuestion,
  type EditorIssue,
  type EditorQuestion,
  editorIssue,
  editorIssues,
  identityPolicies,
  kindLabels,
  serializeQuestions,
  toEditorQuestion,
  toEditorQuestions,
  validatedDraft,
} from "@/lib/specification-model";
import {
  type Draft,
  dateTimeFormat,
  publicationPath,
  specificationsPath,
} from "@/lib/specifications";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { AnswerPreview } from "./answer-preview";
import { DeleteDraftButton } from "./delete-draft-button";
import { ExtractionTest, type TestRun } from "./extraction-test";
import { Field, invalidClass } from "./fields";
import { FixProblemsFirst } from "./preview-parts";
import { QuestionFields, sectionForField } from "./question-fields";
import { QuestionInspector } from "./question-inspector";
import { QuestionList } from "./question-list";
import { ViewTabs } from "./view-tabs";

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

type View = "questions" | "preview" | "test";

// Server issues arrive on a refused publish or test. They sit on the field they are about,
// next to the editor's own checks, unless the editor already reports the same problem.
function serverIssueMessages(
  issues: ContractIssue[],
  questions: EditorQuestion[],
  known: EditorIssue[],
) {
  return issues
    .map((issue) => editorIssue(issue, questions))
    .filter(
      (issue) =>
        !known.some(
          (k) =>
            k.questionId === issue.questionId &&
            k.field === issue.field &&
            k.message === issue.message,
        ),
    );
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
  // Wide screens edit the selected question in an inspector beside the outline.
  const wide = useMediaQuery("(min-width: 64rem)");
  const [inspectorTab, setInspectorTab] = useState<"question" | "answer" | "rules">("question");
  const select = (id: string | null) => {
    if (id !== selectedId) setInspectorTab("question");
    setSelectedId(id);
  };
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved", at: draft.updatedAt });
  const [announcement, setAnnouncement] = useState("");
  const [removing, setRemoving] = useState<EditorQuestion | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<EditorIssue[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [view, setView] = useState<View>("questions");
  const [savedRevision, setSavedRevision] = useState(draft.revision);

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

  const localIssues = useMemo(
    () => [
      ...(content.name.trim()
        ? content.name.trim().length > 80
          ? [{ field: "name", message: "Use 80 characters or fewer for the name." }]
          : []
        : [{ field: "name", message: "Enter a name." }]),
      ...editorIssues(kind, content.description, content.questions),
    ],
    [kind, content],
  );
  const issues = useMemo(() => [...localIssues, ...serverIssues], [localIssues, serverIssues]);
  // The same validator publication uses. Preview and test run only when it passes.
  const validation = useMemo(
    () => validatedDraft(kind, content.description, content.questions),
    [kind, content.description, content.questions],
  );
  const selectedIndex = content.questions.findIndex((q) => q.id === selectedId);
  const selectedQuestion = selectedIndex === -1 ? null : content.questions[selectedIndex];
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
        setSavedRevision(result.draft.revision);
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
    focusBlock(template.id);
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
    setView("questions");
    if (issue.field === "name" || issue.field === "description") {
      document.getElementById(`draft-${issue.field}`)?.focus();
      return;
    }
    if (!issue.questionId) return;
    setSelectedId(issue.questionId);
    setInspectorTab(sectionForField(issue.field));
    requestAnimationFrame(() => {
      const block = document.getElementById(`block-${issue.questionId}`);
      const inspector = wide ? document.getElementById("question-inspector") : null;
      const target =
        (inspector ?? block)?.querySelector<HTMLElement>("[aria-invalid=true]") ??
        block?.querySelector<HTMLElement>("button[aria-expanded]");
      // Wide screens bring the field itself into view, inside the sticky inspector.
      if (wide) {
        block?.scrollIntoView({ block: "nearest" });
        target?.scrollIntoView({ block: "center" });
      } else block?.scrollIntoView({ block: "start" });
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
    setSavedRevision(theirs.revision);
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
        setServerIssues(serverIssueMessages(result.issues, latest.current.questions, localIssues));
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

  // A test runs against the stored draft, so pending edits are saved first.
  // Saves pending edits, then tests the saved revision.
  const runTest = async (messages: DraftTestMessage[]): Promise<TestRun> => {
    if (edits.current !== savedEdits.current) await save();
    if (blockedRef.current)
      return {
        outcome: "error",
        message: "Resolve the message above the questions, then run the test.",
      };
    if (edits.current !== savedEdits.current)
      return {
        outcome: "error",
        message: "Your latest changes are not saved yet. Save them, then run the test.",
      };
    const response = await testSpecificationDraft(organizationId, draft.id, {
      revision: revision.current,
      messages,
    });
    if (response.outcome === "tested")
      return {
        outcome: "tested",
        result: response.result,
        revision: response.revision,
        label: `draft revision ${response.revision}`,
      };
    if (response.outcome === "invalid")
      setServerIssues(serverIssueMessages(response.issues, latest.current.questions, localIssues));
    return { outcome: "error", message: response.message };
  };
  const showProblems = () => {
    setView("questions");
    setSummaryOpen(true);
    requestAnimationFrame(() =>
      document.getElementById("problem-summary")?.scrollIntoView({ block: "center" }),
    );
  };

  const [tone, label] = statusView(status);
  const readOnly = status.kind === "published" || status.kind === "missing";
  const identities = identityPolicies(kind);
  const missingIdentity = identities.filter(
    (p) => p.policy !== "excluded" && !content.questions.some((q) => q.key === p.key),
  );
  const summary = issues.slice(0, 50);
  // A short list is shown straight away; a long one waits behind "Show list".
  const listShown = summaryOpen || issues.length <= 3;
  const issueContext = (issue: EditorIssue) => {
    const index = content.questions.findIndex((q) => q.id === issue.questionId);
    const question = content.questions[index];
    return question ? (
      <span className="font-semibold">
        {index + 1}. {question.label || question.key || "Untitled"}:{" "}
      </span>
    ) : null;
  };

  return (
    <div className="pb-40">
      <PageHeading
        before={
          <nav
            aria-label="Breadcrumb"
            className="flex flex-wrap items-center text-sm text-bumper-ink"
          >
            <Link
              href={specificationsPath(organizationId)}
              className="inline-flex min-h-11 items-center rounded-full px-3 font-semibold text-white underline decoration-white/40 underline-offset-4 hover:bg-white/10"
            >
              Scouting specifications
            </Link>
            <ChevronRight aria-hidden="true" className="size-4 text-bumper-ink/70" />
            <span className="px-2 tabular-nums">{draft.season}</span>
            <ChevronRight aria-hidden="true" className="size-4 text-bumper-ink/70" />
            <span className="px-2">{kindLabels[kind]}</span>
          </nav>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex h-7 items-center gap-2 rounded-full bg-white/15 px-3 text-[0.8125rem] font-semibold text-white">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-sky" />
              Draft
            </span>
            <span>
              {draft.season} {kindLabels[kind].toLowerCase()} scouting
              {draft.source ? ` · copied from ${draft.source.season} ${draft.source.version}` : ""}
              {" · "}publishes as <span className="font-bumper text-white">{nextVersion}</span>
            </span>
          </span>
        }
      >
        {content.name.trim() || "Untitled draft"}
      </PageHeading>

      <div className="mx-auto max-w-6xl space-y-6 px-4 pt-8 sm:px-6">
        {status.kind === "conflict" ? (
          <div role="alert" className="space-y-3 rounded-2xl bg-warning-soft p-5">
            <p className="flex items-center gap-2 font-semibold text-warning-soft-foreground">
              <AlertTriangle aria-hidden="true" className="size-4" />
              Someone else saved this draft
            </p>
            <p className="text-sm">
              Their version was saved {dateTimeFormat.format(new Date(status.theirs.updatedAt))} and
              has {status.theirs.document.questions.length} questions. Yours has{" "}
              {content.questions.length} and is not saved yet. Keep one of them; the other is
              replaced.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onPress={keepMine}>Keep my version</Button>
              <Button variant="outline" className="bg-surface" onPress={loadTheirs}>
                Load their version
              </Button>
            </div>
          </div>
        ) : null}
        {status.kind === "published" ? (
          <div role="status" className="rounded-2xl bg-surface p-5 shadow-surface">
            <p className="font-semibold">This draft was published as {status.version}.</p>
            <p className="mt-1 text-sm text-muted">
              Published versions cannot change. Open it to create a new draft from it.
            </p>
            <LinkButton
              href={publicationPath(organizationId, draft.season, kind, status.version)}
              className="mt-3"
            >
              Open {status.version}
            </LinkButton>
          </div>
        ) : null}
        {status.kind === "missing" ? (
          <div role="alert" className="rounded-2xl bg-surface p-5 shadow-surface">
            <p className="font-semibold">This draft no longer exists.</p>
            <p className="mt-1 text-sm text-muted">
              Another admin deleted it. Your changes on this page were not saved.
            </p>
            <LinkButton
              href={specificationsPath(organizationId)}
              variant="outline"
              className="mt-3"
            >
              Back to specifications
            </LinkButton>
          </div>
        ) : null}

        <ViewTabs
          label="Draft views"
          view={view}
          onChange={setView}
          tabs={[
            { id: "questions", name: "Edit", count: content.questions.length },
            { id: "preview", name: "Preview answers" },
            { id: "test", name: "Test extraction" },
          ]}
        />

        <div
          role="tabpanel"
          id="panel-questions"
          aria-labelledby="tab-questions"
          hidden={view !== "questions"}
          className="space-y-6"
        >
          <fieldset disabled={readOnly} className="space-y-6">
            <legend className="sr-only">Draft details</legend>
            <div className="grid gap-4 rounded-2xl bg-surface p-5 shadow-surface sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:p-6">
              <Field
                id="draft-name"
                label="Name"
                errors={issues.filter((i) => i.field === "name").map((i) => i.message)}
              >
                {(props) => (
                  <Input
                    {...props}
                    fullWidth
                    className={invalidClass}
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
                  <TextArea
                    {...props}
                    fullWidth
                    rows={2}
                    className={invalidClass}
                    value={content.description}
                    onChange={(e) => edit((c) => ({ ...c, description: e.target.value }))}
                  />
                )}
              </Field>
            </div>

            <details className="group rounded-2xl bg-surface shadow-surface">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-3 text-sm font-semibold outline-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/40 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <Lock aria-hidden="true" className="size-4 text-accent" />
                  Identity for {kindLabels[kind].toLowerCase()} scouting
                </span>
                <span className="inline-flex items-center gap-1 text-accent-soft-foreground">
                  <span className="group-open:hidden">Show</span>
                  <span className="hidden group-open:inline">Hide</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  />
                </span>
              </summary>
              <div className="space-y-3 border-t border-separator px-5 py-4 text-sm sm:px-6">
                <p className="text-muted">
                  Identity questions say which match and team an observation is about. They are
                  always asked, and their codes and answer types are fixed. The event always comes
                  from the scouting session.
                </p>
                <ul className="space-y-2">
                  {identities.map((p) => (
                    <li key={p.key}>
                      <span className="font-semibold">{p.label}</span>{" "}
                      <code className="font-mono text-[0.8125rem] text-muted">{p.key}</code>
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
                        variant="outline"
                        onPress={() => addIdentity(p.key, p.policy === "required")}
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        Add {p.label.toLowerCase()} question
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          </fieldset>

          {issues.length ? (
            <section aria-labelledby="problem-summary" className="rounded-2xl bg-danger-soft p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="problem-summary"
                  className="flex items-center gap-2 font-semibold text-danger-soft-foreground"
                >
                  <AlertTriangle aria-hidden="true" className="size-4" />
                  {issues.length === 1
                    ? "1 problem to fix before publishing"
                    : `${issues.length} problems to fix before publishing`}
                </h2>
                {issues.length > 3 ? (
                  <Button
                    variant="ghost"
                    aria-expanded={summaryOpen}
                    aria-controls="problem-list"
                    onPress={() => setSummaryOpen(!summaryOpen)}
                  >
                    {summaryOpen ? "Hide list" : "Show list"}
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 text-sm">Drafts save with problems. Publishing needs none.</p>
              {listShown ? (
                <ul id="problem-list" className="mt-3 space-y-1">
                  {summary.map((issue, index) => {
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: issues have no identity and are recomputed on each edit.
                      <li key={index}>
                        <button
                          type="button"
                          onClick={() => jumpTo(issue)}
                          className="min-h-9 cursor-pointer text-left text-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
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
              <h2 id="questions-title" className="font-display text-xl">
                Questions{" "}
                <span className="font-medium font-stretch-normal text-muted tabular-nums">
                  ({content.questions.length})
                </span>
              </h2>
              <p className="text-sm text-muted">
                In the order scouts are asked. Lines link questions that depend on an earlier
                answer.
              </p>
            </div>
            {content.questions.length ? (
              <fieldset
                disabled={readOnly}
                className="lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-5"
              >
                <legend className="sr-only">Questions</legend>
                <QuestionList
                  kind={kind}
                  questions={content.questions}
                  selectedId={selectedId}
                  onSelect={select}
                  problems={problemsByQuestion}
                  compact={wide}
                  renderBody={(question, index) => (
                    <div className="space-y-6">
                      <div className="flex flex-wrap gap-1 border-b border-separator pb-4">
                        <Button
                          id={`move-up-${question.id}`}
                          variant="ghost"
                          isDisabled={index === 0}
                          onPress={() => move(question, -1)}
                        >
                          <ArrowUp aria-hidden="true" className="size-4" />
                          Move up
                        </Button>
                        <Button
                          id={`move-down-${question.id}`}
                          variant="ghost"
                          isDisabled={index === content.questions.length - 1}
                          onPress={() => move(question, 1)}
                        >
                          <ArrowDown aria-hidden="true" className="size-4" />
                          Move down
                        </Button>
                        <Button variant="ghost" onPress={() => duplicate(question)}>
                          <Copy aria-hidden="true" className="size-4" />
                          Duplicate
                        </Button>
                        {identities.find((p) => p.key === question.key)?.policy === "required" ? (
                          <span className="inline-flex min-h-11 items-center px-3 text-sm text-muted">
                            Required identity questions cannot be removed.
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            className="text-danger hover:bg-danger-soft"
                            onPress={() => setRemoving(question)}
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                            Remove
                          </Button>
                        )}
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
                {wide ? (
                  <div className="sticky top-[calc(var(--site-header-height)+var(--sub-header-height)+1rem)] max-h-[calc(100svh-var(--site-header-height)-var(--sub-header-height)-8rem)] overflow-y-auto rounded-2xl">
                    {selectedQuestion ? (
                      <QuestionInspector
                        kind={kind}
                        question={selectedQuestion}
                        index={selectedIndex}
                        questions={content.questions}
                        contract={validation.ok ? validation.contract : null}
                        problems={fieldProblems(selectedQuestion.id)}
                        tab={inspectorTab}
                        onTabChange={setInspectorTab}
                        onQuestionsChange={editQuestions}
                        onMove={(step) => move(selectedQuestion, step)}
                        onDuplicate={() => duplicate(selectedQuestion)}
                        onRemove={
                          identities.find((p) => p.key === selectedQuestion.key)?.policy ===
                          "required"
                            ? null
                            : () => setRemoving(selectedQuestion)
                        }
                        onClose={() => {
                          const id = selectedQuestion.id;
                          setSelectedId(null);
                          requestAnimationFrame(() =>
                            document
                              .querySelector<HTMLElement>(
                                `#block-${CSS.escape(id)} button[aria-expanded]`,
                              )
                              ?.focus(),
                          );
                        }}
                      />
                    ) : (
                      <div className="rounded-2xl border-2 border-dashed border-border-secondary px-6 py-12 text-center">
                        <p className="font-semibold">Select a question</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                          Its settings open here, with the message scouts get in Telegram.
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
              </fieldset>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-border-secondary px-6 py-10 text-center">
                <p className="font-semibold">No questions yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                  Add the first thing scouts should report. Each question needs a follow-up for when
                  the answer is missing.
                </p>
                {!readOnly ? (
                  <Button className="mt-4" onPress={addQuestion}>
                    <Plus aria-hidden="true" className="size-4" />
                    Add question
                  </Button>
                ) : null}
              </div>
            )}
            {!readOnly ? (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                {content.questions.length ? (
                  <Button variant="outline" onPress={addQuestion}>
                    <Plus aria-hidden="true" className="size-4" />
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

        <div
          role="tabpanel"
          id="panel-preview"
          aria-labelledby="tab-preview"
          hidden={view !== "preview"}
        >
          {validation.ok ? (
            <AnswerPreview
              kind={kind}
              contract={validation.contract}
              questions={content.questions}
            />
          ) : (
            <FixProblemsFirst
              count={localIssues.length}
              action="preview answers"
              onShowProblems={showProblems}
            />
          )}
        </div>
        <div role="tabpanel" id="panel-test" aria-labelledby="tab-test" hidden={view !== "test"}>
          {validation.ok ? (
            <ExtractionTest
              kind={kind}
              contract={validation.contract}
              target="this draft as saved"
              run={runTest}
              revision={savedRevision}
              dirty={status.kind !== "saved"}
            />
          ) : (
            <FixProblemsFirst
              count={localIssues.length}
              action="test extraction"
              onShowProblems={showProblems}
            />
          )}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* The action bar stays in reach while the list scrolls. */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-6xl px-2 pb-2 sm:px-6 sm:pb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 shadow-overlay sm:px-5">
          <span role="status" aria-live="polite" className="flex items-center gap-2">
            <StatusBadge tone={tone}>{label}</StatusBadge>
          </span>
          {status.kind === "error" ? (
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-danger">
              {status.message}
              <Button size="sm" variant="outline" onPress={() => void save()}>
                Try again
              </Button>
            </span>
          ) : status.kind === "unsaved" ? (
            <Button size="sm" variant="ghost" className="max-sm:hidden" onPress={() => void save()}>
              Save now
            </Button>
          ) : null}
          {issues.length ? (
            <button
              type="button"
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-danger-soft px-3 text-sm font-semibold text-danger-soft-foreground hover:bg-danger-soft-hover"
              onClick={() => {
                setSummaryOpen(true);
                document.getElementById("problem-summary")?.scrollIntoView({ block: "center" });
              }}
            >
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              {issues.length === 1 ? "1 problem" : `${issues.length} problems`}
            </button>
          ) : null}
          <span className="flex-1" />
          {!readOnly ? (
            <>
              <Button
                variant="outline"
                className={cn("max-sm:hidden", view !== "questions" && "hidden")}
                onPress={addQuestion}
              >
                <Plus aria-hidden="true" className="size-4" />
                Add question
              </Button>
              <Button
                className="px-5 max-sm:w-full"
                isDisabled={status.kind === "conflict"}
                onPress={() => {
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

      <AlertDialog.Backdrop
        isOpen={removing !== null}
        onOpenChange={(open) => (open ? null : setRemoving(null))}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading className="[overflow-wrap:anywhere]">
                Remove “{removing?.label || removing?.key || "this question"}”?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-pretty text-muted">
                {removing && dependents(removing).length
                  ? `Rules on ${dependents(removing)
                      .map((q) => `“${q.label || q.key}”`)
                      .join(", ")} use its answer. Those rules will need fixing before you publish.`
                  : "The question and its rules are removed from this draft."}
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer className="max-sm:flex-col-reverse max-sm:items-stretch">
              <Button variant="tertiary" slot="close" autoFocus>
                Keep question
              </Button>
              <Button variant="danger" onPress={() => removing && remove(removing)}>
                Remove question
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <FormDialog
        isOpen={publishOpen}
        onOpenChange={setPublishOpen}
        isPending={publishing}
        title={
          issues.length
            ? issues.length === 1
              ? "Fix 1 problem before publishing"
              : `Fix ${issues.length} problems before publishing`
            : `Publish “${content.name.trim()}”?`
        }
        description={
          issues.length
            ? "Select a problem to go to it. Your draft is kept."
            : "A published version cannot be edited. To change it later, create a new draft from it."
        }
        size="lg"
      >
        {issues.length ? (
          <>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {summary.map((issue, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: issues have no identity.
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => jumpTo(issue)}
                    className="min-h-9 cursor-pointer text-left text-sm text-danger underline-offset-4 hover:underline"
                  >
                    {issueContext(issue)}
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
            <DialogActions>
              <Button variant="tertiary" onPress={() => setPublishOpen(false)}>
                Back to editing
              </Button>
            </DialogActions>
          </>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Season", String(draft.season)],
                ["Kind", kindLabels[kind]],
                ["Version", nextVersion],
              ].map(([term, value]) => (
                <div key={term} className="rounded-xl bg-bumper px-2 py-3 text-white">
                  <dt className="text-xs font-semibold text-bumper-ink">{term}</dt>
                  <dd className="font-bumper mt-0.5 text-xl [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm">
              {content.questions.length} questions. Publishing does not change any event. Next, you
              choose which events use it for new scouting sessions.
            </p>
            {publishError ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {publishError}
              </p>
            ) : null}
            <DialogActions>
              <Button
                variant="tertiary"
                isDisabled={publishing}
                onPress={() => setPublishOpen(false)}
              >
                Cancel
              </Button>
              <Button isPending={publishing} className="px-5" onPress={publish}>
                {publishing ? "Publishing…" : `Publish ${nextVersion}`}
              </Button>
            </DialogActions>
          </div>
        )}
      </FormDialog>
    </div>
  );
}
