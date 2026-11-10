import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { requirements } from "@ai-scouting/scouting";
import { db } from "./db.ts";
import { enrollMember } from "./repositories/members.ts";
import {
  assignSpecification,
  createDraft,
  deleteDraft,
  listEventAssignments,
  listSpecifications,
  loadDraft,
  publishDraft,
  readEventAssignments,
  readPublication,
  saveDraft,
} from "./repositories/specifications.ts";
import { approveWebAdmin, linkWebAdmin } from "./repositories/web-admin.ts";

after(() => db.destroy());

const subject = () => `user_${randomUUID().replaceAll("-", "")}`;

async function team() {
  const org = randomUUID();
  const admin = subject();
  const member = await enrollMember({
    organizationId: org,
    organizationName: "Specification fixture",
    frcTeamNumber: 1241,
    memberName: "Admin",
    role: "admin",
    channel: "fixture",
    externalUserId: randomUUID(),
  });
  await approveWebAdmin({ organizationId: org, memberId: member, approverId: member });
  await linkWebAdmin(org, member, admin);
  return { org, admin, member };
}

async function event(org: string, season: number) {
  await db
    .insertInto("published_specification")
    .values({
      organization_id: org,
      season,
      kind: "match",
      version: requirements.version,
      document: JSON.stringify(requirements),
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const row = await db
    .insertInto("event")
    .values({
      organization_id: org,
      name: `Event ${season}`,
      season,
      type: "practice",
      start_date: `${season}-03-01`,
      end_date: `${season}-03-02`,
      timezone: "America/Toronto",
      specification_version: requirements.version,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const climb = {
  key: "climbed",
  label: "Climbed",
  prompt: "Did the robot complete a climb?",
  guidance: "true for a completed climb, false for an explicit failure.",
  required: true,
  answer: { type: "boolean" },
};

test("drafts are tenant-scoped, accept incomplete content and detect stale saves", async () => {
  const { org, admin, member } = await team();
  const other = await team();
  const created = await createDraft(org, admin, {
    season: 2027,
    kind: "match",
    name: "Match 2027",
    source: { type: "blank" },
  });
  assert.equal(created?.outcome, "created");
  if (created?.outcome !== "created") return;
  const { draft } = created;
  // Blank drafts start with the protected identity questions for the kind.
  assert.deepEqual(
    draft.document.questions.map((q) => (q as { key: string }).key),
    ["match", "team_number"],
  );
  assert.deepEqual(draft.issues, []);

  // Other teams and their admins cannot see or change it.
  assert.equal(await loadDraft(org, other.admin, draft.id), null);
  assert.equal(await loadDraft(other.org, other.admin, draft.id), "not_found");
  assert.equal(await deleteDraft(other.org, other.admin, draft.id), false);
  assert.deepEqual((await listSpecifications(other.org, other.admin))?.drafts, []);

  // Incomplete content saves, with addressable issues.
  const broken = {
    description: "Work in progress",
    questions: [
      ...draft.document.questions,
      {
        ...climb,
        rules: [{ effect: "show", when: { question: "missing", operator: "equals", value: true } }],
      },
    ],
  };
  const saved = await saveDraft(org, admin, draft.id, {
    revision: 1,
    name: "Match",
    document: broken,
  });
  assert.equal(saved?.outcome, "saved");
  if (saved?.outcome !== "saved") return;
  assert.equal(saved.draft.revision, 2);
  assert.equal(saved.draft.issues[0]?.code, "missing_reference");
  assert.deepEqual(saved.draft.issues[0]?.path.slice(0, 2), ["questions", 2]);

  // A save from an older revision is refused and returns the stored draft.
  const stale = await saveDraft(org, admin, draft.id, {
    revision: 1,
    name: "Overwrite",
    document: { description: "", questions: [] },
  });
  assert.equal(stale?.outcome, "conflict");
  if (stale?.outcome === "conflict") {
    assert.equal(stale.draft.revision, 2);
    assert.equal(stale.draft.name, "Match");
  }
  const stored = await db
    .selectFrom("specification_draft")
    .select(["updated_by", "created_by"])
    .where("id", "=", draft.id)
    .executeTakeFirstOrThrow();
  assert.equal(stored.updated_by, member);

  // Duplicating copies content; deleting removes only the copy.
  const copy = await createDraft(org, admin, {
    season: 2028,
    kind: "match",
    name: "Copy",
    source: { type: "draft", id: draft.id },
  });
  assert.equal(copy?.outcome, "created");
  if (copy?.outcome === "created") {
    assert.equal(copy.draft.season, 2028);
    assert.deepEqual(copy.draft.document, saved.draft.document);
    assert.equal(await deleteDraft(org, admin, copy.draft.id), true);
    assert.equal(await loadDraft(org, admin, copy.draft.id), "not_found");
  }
  // A copy must keep the kind; identity differs by kind.
  assert.deepEqual(
    await createDraft(org, admin, {
      season: 2027,
      kind: "pit",
      name: "x",
      source: { type: "draft", id: draft.id },
    }),
    { outcome: "source_not_found" },
  );

  // Revoked admin access stops every operation.
  await db.updateTable("member").set({ role: "scout" }).where("id", "=", member).execute();
  assert.equal(await loadDraft(org, admin, draft.id), null);
  assert.equal(await publishDraft(org, admin, draft.id, 2), null);
  assert.equal(await listSpecifications(org, admin), null);
});

test("publication validates fully, numbers versions and replays retries", async () => {
  const { org, admin } = await team();
  const create = async (name: string) => {
    const result = await createDraft(org, admin, {
      season: 2027,
      kind: "match",
      name,
      source: { type: "blank" },
    });
    assert.equal(result?.outcome, "created");
    return result?.outcome === "created" ? result.draft : assert.fail();
  };
  const draft = await create("Match");
  const withClimb = (questions: unknown[], rules?: unknown[]) => ({
    description: "Climb only",
    questions: [...questions, rules ? { ...climb, rules } : climb],
  });
  const invalid = await saveDraft(org, admin, draft.id, {
    revision: 1,
    name: "Match",
    document: withClimb(draft.document.questions, [
      { effect: "show", when: { question: "climbed", operator: "equals", value: true } },
    ]),
  });
  assert.equal(invalid?.outcome, "saved");
  const refused = await publishDraft(org, admin, draft.id, 2);
  assert.equal(refused?.outcome, "invalid");
  if (refused?.outcome === "invalid") assert.equal(refused.issues[0]?.code, "self_reference");
  assert.equal(
    (
      await db
        .selectFrom("published_specification")
        .select("version")
        .where("organization_id", "=", org)
        .where("season", "=", 2027)
        .execute()
    ).length,
    0,
  );

  await saveDraft(org, admin, draft.id, {
    revision: 2,
    name: "Match",
    document: withClimb(draft.document.questions),
  });
  // Publishing an older revision is refused.
  assert.equal((await publishDraft(org, admin, draft.id, 2))?.outcome, "conflict");
  const first = await publishDraft(org, admin, draft.id, 3);
  assert.equal(first?.outcome, "published");
  if (first?.outcome !== "published") return;
  assert.equal(first.publication.version, "v1");
  assert.equal(first.replayed, false);
  // A retry returns the same version instead of creating another.
  const retry = await publishDraft(org, admin, draft.id, 3);
  assert.deepEqual(retry?.outcome === "published" && [retry.publication.version, retry.replayed], [
    "v1",
    true,
  ]);
  // A published draft is locked and leaves the draft list.
  assert.deepEqual(
    await saveDraft(org, admin, draft.id, { revision: 3, name: "x", document: withClimb([]) }),
    {
      outcome: "published",
      version: "v1",
    },
  );
  assert.equal(await loadDraft(org, admin, draft.id), "not_found");
  assert.equal(await deleteDraft(org, admin, draft.id), false);

  const stored = await readPublication(org, admin, 2027, "match", "v1");
  assert.ok(stored && stored !== "not_found");
  assert.equal(stored.contract.version, "v1");
  assert.equal(stored.contract.formatVersion, 2);
  assert.equal(stored.name, "Match");

  // Concurrent publication of different drafts gets distinct versions.
  const [a, b] = [await create("A"), await create("B")];
  const results = await Promise.all([
    publishDraft(org, admin, a.id, 1),
    publishDraft(org, admin, b.id, 1),
  ]);
  assert.deepEqual(
    results.map((r) => (r?.outcome === "published" ? r.publication.version : r?.outcome)).sort(),
    ["v2", "v3"],
  );
  // Concurrent retries of one draft create one version.
  const c = await create("C");
  const same = await Promise.all([
    publishDraft(org, admin, c.id, 1),
    publishDraft(org, admin, c.id, 1),
  ]);
  assert.deepEqual(
    same.map((r) => (r?.outcome === "published" ? r.publication.version : r?.outcome)),
    ["v4", "v4"],
  );
  assert.deepEqual(same.map((r) => r?.outcome === "published" && r.replayed).sort(), [false, true]);

  // Editing a publication starts a new draft; history is unchanged.
  const edit = await createDraft(org, admin, {
    season: 2027,
    kind: "match",
    name: "Edit v1",
    source: { type: "publication", season: 2027, version: "v1" },
  });
  assert.equal(edit?.outcome === "created" && edit.draft.source?.version, "v1");
  await assert.rejects(
    db
      .updateTable("published_specification")
      .set({ name: "changed" })
      .where("organization_id", "=", org)
      .execute(),
    /immutable/,
  );
});

test("format 1 publications stay readable and copy into the current format", async () => {
  const { org, admin } = await team();
  await event(org, 2026);
  const legacy = await readPublication(org, admin, 2026, "match", requirements.version);
  assert.ok(legacy && legacy !== "not_found");
  assert.equal(legacy.formatVersion, 1);
  assert.deepEqual(
    legacy.contract.questions.map((q) => q.key),
    requirements.fields.map((f) => f.key),
  );
  const listed = await listSpecifications(org, admin, { season: 2026, kind: "match" });
  assert.equal(listed?.publications[0]?.assignedEventIds.length, 1);
  const copy = await createDraft(org, admin, {
    season: 2027,
    kind: "match",
    name: "From starter",
    source: { type: "publication", season: 2026, version: requirements.version },
  });
  assert.equal(copy?.outcome, "created");
  if (copy?.outcome === "created") assert.deepEqual(copy.draft.issues, []);
});

test("assignment is per event and kind, checks season and keeps match on the existing selection", async () => {
  const { org, admin } = await team();
  const other = await team();
  const eventId = await event(org, 2027);
  const oldEvent = await event(org, 2026);
  const publish = async (kind: "match" | "pit" | "general", season: number) => {
    const created = await createDraft(org, admin, {
      season,
      kind,
      name: `${kind} ${season}`,
      source: { type: "blank" },
    });
    assert.ok(created?.outcome === "created");
    const document =
      kind === "general"
        ? {
            description: "",
            questions: [
              ...created.draft.document.questions,
              { ...climb, key: "notes", answer: { type: "text" } },
            ],
          }
        : created.draft.document;
    await saveDraft(org, admin, created.draft.id, {
      revision: 1,
      name: created.draft.name,
      document,
    });
    const result = await publishDraft(org, admin, created.draft.id, 2);
    assert.ok(result?.outcome === "published", JSON.stringify(result));
    return result.publication.version;
  };
  const pit = await publish("pit", 2027);
  const general = await publish("general", 2027);
  const match = await publish("match", 2027);

  assert.equal(await readEventAssignments(org, other.admin, eventId), null);
  assert.equal(await readEventAssignments(other.org, other.admin, eventId), "not_found");
  assert.equal(
    await assignSpecification(other.org, other.admin, eventId, "pit", pit).then((r) => r?.outcome),
    "event_not_found",
  );

  const assigned = await assignSpecification(org, admin, eventId, "pit", pit);
  assert.equal(assigned?.outcome, "assigned");
  await assignSpecification(org, admin, eventId, "general", general);
  const current = await readEventAssignments(org, admin, eventId);
  assert.ok(current && current !== "not_found");
  assert.deepEqual(
    [current.match, current.pit, current.general],
    [{ version: requirements.version }, { version: pit }, { version: general }],
  );
  // Repeating an assignment is a no-op.
  assert.equal((await assignSpecification(org, admin, eventId, "pit", pit))?.outcome, "assigned");

  // Season and kind must match the event.
  assert.equal(
    (await assignSpecification(org, admin, oldEvent, "pit", pit))?.outcome,
    "season_mismatch",
  );
  assert.equal(
    (await assignSpecification(org, admin, eventId, "pit", "v99"))?.outcome,
    "publication_not_found",
  );
  // Match intake keeps format 1 until custom extraction (#48), and match cannot be cleared.
  assert.equal(
    (await assignSpecification(org, admin, eventId, "match", match))?.outcome,
    "unsupported_by_intake",
  );
  assert.equal(
    (await assignSpecification(org, admin, eventId, "match", null))?.outcome,
    "required",
  );
  assert.equal(
    (await assignSpecification(org, admin, eventId, "match", requirements.version))?.outcome,
    "assigned",
  );

  // Concurrent assignment of the same kind leaves one consistent row.
  const pit2 = await publish("pit", 2027);
  await Promise.all([
    assignSpecification(org, admin, eventId, "pit", pit),
    assignSpecification(org, admin, eventId, "pit", pit2),
  ]);
  const rows = await db
    .selectFrom("event_specification_assignment")
    .select("version")
    .where("organization_id", "=", org)
    .where("event_id", "=", eventId)
    .where("kind", "=", "pit")
    .execute();
  assert.equal(rows.length, 1);
  assert.ok([pit, pit2].includes(rows[0]?.version ?? ""));

  // Clearing pit leaves the publication in history.
  const cleared = await assignSpecification(org, admin, eventId, "pit", null);
  assert.ok(cleared?.outcome === "assigned");
  assert.equal(cleared.assignments.pit, null);
  assert.ok(await readPublication(org, admin, 2027, "pit", pit));

  // The builder's event list: newest first, with each kind's current selection.
  assert.equal(await listEventAssignments(org, other.admin), null);
  const listed = await listEventAssignments(org, admin);
  assert.deepEqual(
    listed?.map((e) => [e.event.id, e.event.startDate, e.match, e.pit, e.general]),
    [
      [eventId, "2027-03-01", { version: requirements.version }, null, { version: general }],
      [oldEvent, "2026-03-01", { version: requirements.version }, null, null],
    ],
  );
});
