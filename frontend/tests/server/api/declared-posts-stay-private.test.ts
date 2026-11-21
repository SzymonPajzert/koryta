import { describe, it, expect, vi, beforeAll } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  MemoryDocumentReference,
  MemoryTimestamp,
  memoryFirestoreModule,
  sharedMemoryFirestore,
} from "../memoryFirestore";
import { DECLARATION_ACTOR } from "../../../shared/declarations";
import type { DeclaredPost } from "../../../shared/model";

import edgesByNode from "../../../server/api/edges/byNode.get";
import edgesByReference from "../../../server/api/edges/byReference.get";
import edgesCreate from "../../../server/api/edges/create.post";
import edgesDelete from "../../../server/api/edges/delete.post";
import edgeReferences from "../../../server/api/edges/[id]/references.get";
import edgeReferencesPost from "../../../server/api/edges/[id]/references.post";
import edgesPending from "../../../server/api/edges/pending.get";
import edgesPublish from "../../../server/api/edges/publish.post";
import edgesRecentEmployments from "../../../server/api/edges/recentEmployments.get";
import edgesServiceMilestones from "../../../server/api/edges/serviceMilestones.get";
import edgesSuccessions from "../../../server/api/edges/successions.get";
import edgesUnpublished from "../../../server/api/edges/unpublished.get";
import edgesUpdate from "../../../server/api/edges/update.post";
import * as edgesIndex from "../../../server/api/edges/index.get";
import revisionsApprove from "../../../server/api/revisions/approve.post";
import revisionsByNode from "../../../server/api/revisions/byNode.get";
import revisionsCreate from "../../../server/api/revisions/create.post";
import revisionById from "../../../server/api/revisions/[id].get";
import revisionsMine from "../../../server/api/revisions/mine.get";
import revisionsNode from "../../../server/api/revisions/node.get";
import revisionsPendingEdges from "../../../server/api/revisions/pendingEdges.get";
import revisionsQueue from "../../../server/api/revisions/queue.get";
import revisionsReject from "../../../server/api/revisions/reject.post";
import revisionsRelations from "../../../server/api/revisions/relations.get";

/**
 * What declarations say about a post stays on the edge, all but what a page
 * reads of it: no edge or revision route hands out an entry's income, how many
 * readers agreed on it or how it settled. Every route under /api/edges and
 * /api/revisions is run here, over one Firestore in memory, after the edge
 * writes have each had their turn at the edges that carry entries.
 */

/** The request a route is handed: who asks, and what they send. */
type Call = {
  as?: "admin" | "reader";
  query?: Record<string, unknown>;
  body?: unknown;
  params?: Record<string, string>;
};
type TestEvent = {
  query: Record<string, unknown>;
  body: unknown;
  params: Record<string, string>;
  headers: Record<string, string>;
  context: Record<string, unknown>;
};

const caller = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  const g = globalThis as Any;
  g.defineEventHandler = (fn: Any) => fn;
  g.defineCachedFunction = (fn: Any) => fn;
  g.createError = (error: Any) =>
    Object.assign(new Error(error.message ?? error.statusMessage), error);
  g.getQuery = (event: Any) => event.query;
  g.getValidatedQuery = async (event: Any, parse: Any) => parse(event.query);
  g.readBody = async (event: Any) => event.body;
  g.readValidatedBody = async (event: Any, parse: Any) => parse(event.body);
  g.getRouterParam = (event: Any, name: string) => event.params[name];
  g.setResponseHeader = () => {};
  g.useStorage = () => ({
    clear: async () => {},
    getKeys: async () => [],
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  });
  g.useRuntimeConfig = () => ({ public: { siteUrl: "https://koryta.pl" } });
  return { current: { uid: "admin-1", admin: true } as Any };
});

vi.mock("firebase-admin/firestore", () =>
  memoryFirestoreModule(sharedMemoryFirestore()),
);
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: async () => ({ users: [], notFound: [] }) }),
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  getValidatedQuery: async (
    event: TestEvent,
    parse: (query: unknown) => unknown,
  ) => parse(event.query),
  getRouterParam: (event: TestEvent, name: string) => event.params[name],
  setResponseHeader: () => {},
}));
vi.mock("../../../server/utils/auth", () => ({
  getUser: async () => caller.current,
  getOptionalUser: async () => caller.current,
  requireAdmin: async () => {
    if (caller.current.admin !== true) throw { statusCode: 403 };
    return caller.current;
  },
}));
// Signed in, so every route answers with its drafts as well.
vi.mock("../../../server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => fn,
  readerAwareCachedEventHandler: (fn: unknown) => fn,
  editorFreshCachedEventHandler: (fn: unknown) => fn,
  eventHasUser: async () => true,
  resolveReader: async () => true,
  wantsLatest: async () => true,
  bodyWantsLatest: async () => true,
}));
vi.mock("../../../server/utils/revisionNotifications", () => ({
  notifyRevisionReviewed: async () => {},
}));
vi.mock("../../../server/utils/declarationDecisions", () => ({
  afterHandPublication: async () => {},
}));

const db = sharedMemoryFirestore();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: any) => unknown;

/** Every route file under /api/edges and /api/revisions, by its path there. */
const routes: Record<string, Handler | null> = {
  "edges/byNode.get.ts": edgesByNode,
  "edges/byReference.get.ts": edgesByReference,
  "edges/create.post.ts": edgesCreate,
  "edges/delete.post.ts": edgesDelete,
  "edges/[id]/references.get.ts": edgeReferences,
  "edges/[id]/references.post.ts": edgeReferencesPost,
  // Exports no handler, so there is nothing to serve.
  "edges/index.get.ts": null,
  "edges/pending.get.ts": edgesPending,
  "edges/publish.post.ts": edgesPublish,
  "edges/recentEmployments.get.ts": edgesRecentEmployments,
  "edges/serviceMilestones.get.ts": edgesServiceMilestones,
  "edges/successions.get.ts": edgesSuccessions,
  "edges/unpublished.get.ts": edgesUnpublished,
  "edges/update.post.ts": edgesUpdate,
  "revisions/approve.post.ts": revisionsApprove,
  "revisions/byNode.get.ts": revisionsByNode,
  "revisions/create.post.ts": revisionsCreate,
  "revisions/[id].get.ts": revisionById,
  "revisions/mine.get.ts": revisionsMine,
  "revisions/node.get.ts": revisionsNode,
  "revisions/pendingEdges.get.ts": revisionsPendingEdges,
  "revisions/queue.get.ts": revisionsQueue,
  "revisions/reject.post.ts": revisionsReject,
  "revisions/relations.get.ts": revisionsRelations,
};

/** What each route answered, by its path. */
const answers = new Map<string, unknown[]>();

async function call(file: string, request: Call = {}) {
  caller.current =
    request.as === "reader"
      ? { uid: "reader-1" }
      : { uid: "admin-1", admin: true };
  const event: TestEvent = {
    query: request.query ?? {},
    body: request.body,
    params: request.params ?? {},
    headers: { authorization: "Bearer token" },
    context: {},
  };
  const answer = await routes[file]!(event);
  answers.set(file, [...(answers.get(file) ?? []), answer]);
  return answer as Record<string, unknown>;
}

/** Where in an answer a field named like an entry's private one sits. */
function privateFieldsIn(
  value: unknown,
  path = "$",
  seen = new Set<unknown>(),
): string[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (
    value instanceof MemoryDocumentReference ||
    value instanceof MemoryTimestamp
  ) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) =>
      privateFieldsIn(item, `${path}[${i}]`, seen),
    );
  }
  return Object.entries(value).flatMap(([key, item]) => [
    ...(["income", "readers", "by"].includes(key) ? [`${path}.${key}`] : []),
    ...privateFieldsIn(item, `${path}.${key}`, seen),
  ]);
}

/** An entry as the declarations automation writes it, income included. */
function entry(asOf: string, fields: Partial<DeclaredPost> = {}): DeclaredPost {
  return {
    url: "https://bip.example.pl/oswiadczenie.pdf",
    as_of: asOf,
    kind: "annual",
    band: "employer",
    role: "wicestarosta",
    roleId: "wicestarosta",
    by: "readers",
    readers: 2,
    at: "2026-11-19T12:00:00.000Z",
    income: [
      {
        amount: 12345678,
        currency: "PLN",
        from: `${asOf}-01-01`,
        to: `${asOf}-12-31`,
        measure: "dochod",
        gross: "brutto",
        kind: "pay",
        line: "f00d-p1:viii:0",
        part: 0,
        partRole: "single",
      },
    ],
    ...fields,
  };
}

const FIRST = "f00d-p1:employer:0";
const LATER = "beef-p1:employer:0";
const earlier = (day: string) => MemoryTimestamp.fromDate(new Date(day));

/** A published person; a post a declaration created, still waiting for its
 * first review; a register seat a declaration annotated; another declared post
 * an admin will remove; and a post from before revisions. */
function seedTheWorld() {
  db.clear();
  const post = {
    type: "employed",
    source: "person",
    target: "starostwo",
    name: "wicestarosta",
    start_date: "2019-11-21",
    references: ["article"],
  };
  const seat = {
    type: "employed",
    source: "person",
    target: "spolka",
    name: "Zarząd",
    start_date: "2020-01-01",
  };
  const gone = { ...post, name: "sekretarz", start_date: "2015-01-01" };
  const before = {
    ...post,
    source: "jan",
    start_date: "2014-12-01",
    end_date: "2019-11-20",
    references: [],
  };
  const imported = {
    collection: "edges",
    update_user: "pipeline-people-import",
    update_automatic: true,
    status: "approved",
    update_time: earlier("2026-10-01"),
  };
  db.seed({
    "nodes/person": {
      type: "person",
      name: "Anna Nowak",
      published: true,
      parties: ["PiS"],
      revision_id: db.doc("revisions/person-rev"),
    },
    "revisions/person-rev": {
      ...imported,
      collection: "nodes",
      node_id: "person",
      data: { type: "person", name: "Anna Nowak", parties: ["PiS"] },
    },
    "nodes/jan": {
      type: "person",
      name: "Jan Kowalski",
      published: true,
      revision_id: db.doc("revisions/jan-rev"),
    },
    "revisions/jan-rev": {
      ...imported,
      collection: "nodes",
      node_id: "jan",
      data: { type: "person", name: "Jan Kowalski" },
    },
    "nodes/starostwo": {
      type: "place",
      name: "Starostwo Powiatowe w Jaśle",
      published: true,
      isPublic: true,
    },
    // Who held the post before her, so it has changed hands.
    "edges/before": {
      ...before,
      published: true,
      revision_id: db.doc("revisions/before-rev"),
    },
    "revisions/before-rev": { ...imported, node_id: "before", data: before },
    "nodes/spolka": {
      type: "place",
      name: "MZGK Bolesławiec",
      published: true,
      isPublic: true,
    },
    "nodes/article": {
      type: "article",
      name: "Wicestarosta na nowo",
      sourceURL: "https://example.pl/a",
      published: true,
    },
    "nodes/article2": {
      type: "article",
      name: "Drugi artykuł",
      sourceURL: "https://example.pl/b",
      published: true,
    },
    "edges/post": {
      ...post,
      published: false,
      as_of: "2024",
      declared: { [FIRST]: entry("2024") },
    },
    "revisions/post-rev": {
      node_id: "post",
      collection: "edges",
      data: post,
      update_user: DECLARATION_ACTOR,
      update_automatic: true,
      status: "pending",
      update_time: earlier("2026-11-01"),
    },
    "edges/seat": {
      ...seat,
      published: true,
      revision_id: db.doc("revisions/seat-rev"),
      declared: {
        "c0de-p1:employer:0": entry("2024", { role: "prezes zarządu" }),
      },
    },
    "revisions/seat-rev": { ...imported, node_id: "seat", data: seat },
    "edges/gone": {
      ...gone,
      published: true,
      revision_id: db.doc("revisions/gone-rev"),
      as_of: "2023",
      declared: { "d00d-p1:employer:0": entry("2023", { role: "sekretarz" }) },
    },
    "revisions/gone-rev": { ...imported, node_id: "gone", data: gone },
    "edges/legacy": {
      type: "employed",
      source: "person",
      target: "spolka",
      name: "Prokurent",
      start_date: "2018-01-01",
      published: false,
      revision_id: null,
      declared: { "e00d-p1:employer:0": entry("2024", { role: "prokurent" }) },
    },
  });
}

/** Every edge write, each at an edge that carries entries, in the order a
 * week of work could bring them. */
async function writeEverything() {
  // A contributor proposes a correction of the declared post...
  const proposal = await call("edges/update.post.ts", {
    as: "reader",
    body: { edge_id: "post", start_date: "2019-11-20" },
  });
  // ...then the automation writes what a later declaration says about it.
  await db.doc("edges/post").update({
    [`declared.${LATER}`]: entry("2025"),
    as_of: "2025",
  });
  await call("edges/[id]/references.post.ts", {
    params: { id: "post" },
    body: { add: ["article2"] },
  });
  await call("edges/publish.post.ts", {
    body: { edge_ids: ["post"], published: true },
  });
  // The older proposal, approved now, after the entry was added.
  await call("revisions/approve.post.ts", {
    body: { revision_id: proposal.revision_id },
  });
  await call("edges/update.post.ts", {
    body: { edge_id: "seat", end_date: "2025-06-30" },
  });
  const rename = await call("edges/update.post.ts", {
    as: "reader",
    body: { edge_id: "seat", name: "Prezes Zarządu" },
  });
  await call("revisions/reject.post.ts", {
    body: { revision_id: rename.revision_id, reason: "Rejestr mówi Zarząd." },
  });
  await call("edges/delete.post.ts", {
    body: { edge_id: "gone", reason: "Duplikat." },
  });
  await call("edges/create.post.ts", {
    as: "reader",
    body: {
      type: "employed",
      source: "person",
      target: "starostwo",
      name: "naczelnik",
      start_date: "2012-01-01",
    },
  });
  await call("revisions/create.post.ts", {
    as: "reader",
    body: { node_id: "person", name: "Anna Maria Nowak" },
  });
}

/** Each read, and what it has to show of the edges above for its answer to
 * say anything. */
const reads: Record<
  string,
  () => { call: Call; shows: (answer: Record<string, unknown>) => unknown }[]
> = {
  "edges/byNode.get.ts": () => [
    {
      call: { query: { nodeId: "person" } },
      shows: (answer) =>
        (answer.relations as { id: string }[]).some((row) => row.id === "post"),
    },
  ],
  "edges/byReference.get.ts": () => [
    {
      call: { query: { articleId: "article" } },
      shows: (answer) =>
        (answer.edges as { id: string }[]).some((row) => row.id === "post"),
    },
  ],
  "edges/[id]/references.get.ts": () => [
    {
      call: { params: { id: "post" } },
      shows: (answer) => (answer.sources as unknown[]).length > 0,
    },
  ],
  "edges/pending.get.ts": () => [
    { call: {}, shows: (answer) => "legacy" in answer },
  ],
  "edges/recentEmployments.get.ts": () => [
    {
      call: { query: { limit: 20 } },
      shows: (answer) =>
        (answer.employments as { id: string }[]).some(
          (row) => row.id === "post",
        ),
    },
  ],
  // Its cards depend on today's date, so it only has to answer.
  "edges/serviceMilestones.get.ts": () => [
    { call: { query: { scope: "recent" } }, shows: () => true },
  ],
  "edges/successions.get.ts": () => [
    {
      call: { query: { companyId: "starostwo" } },
      shows: (answer) =>
        (answer.current as { edgeId: string }[]).some(
          (row) => row.edgeId === "post",
        ),
    },
    {
      call: { query: { personId: "person" } },
      shows: (answer) => (answer.posts as unknown[]).length > 0,
    },
  ],
  "edges/unpublished.get.ts": () => [
    {
      call: { query: {} },
      shows: (answer) =>
        (answer.edges as { id: string }[]).some((row) => row.id === "legacy"),
    },
  ],
  "revisions/byNode.get.ts": () =>
    ["post", "seat", "gone", "legacy"].map((nodeId) => ({
      call: { query: { nodeId } },
      shows: (answer) =>
        nodeId === "legacy" || (answer.revisions as unknown[]).length > 0,
    })),
  "revisions/[id].get.ts": () =>
    [...db.documents("revisions").keys()].map((id) => ({
      call: { params: { id } },
      shows: (answer) => !!answer,
    })),
  "revisions/mine.get.ts": () => [
    {
      call: { as: "reader", query: {} },
      shows: (answer) => (answer.revisions as unknown[]).length > 0,
    },
  ],
  "revisions/node.get.ts": () => [
    {
      call: { query: { nodeId: "post" } },
      shows: (answer) => (answer.revisions as unknown[]).length > 0,
    },
  ],
  "revisions/pendingEdges.get.ts": () => [
    {
      call: { query: {} },
      shows: (answer) =>
        (answer.revisions as { edgeId: string }[]).some(
          (row) => row.edgeId === "post",
        ),
    },
  ],
  "revisions/queue.get.ts": () => [
    {
      call: { query: { status: "all", automatic: "all" } },
      shows: (answer) => (answer.revisions as unknown[]).length > 0,
    },
  ],
  "revisions/relations.get.ts": () => [
    {
      call: { query: { nodeId: "person" } },
      shows: (answer) =>
        (answer.relations as { id: string }[]).some((row) => row.id === "post"),
    },
  ],
};

const writes = Object.keys(routes).filter(
  (file) => routes[file] && !(file in reads),
);

describe("what declarations say about a post", () => {
  beforeAll(async () => {
    seedTheWorld();
    await writeEverything();
  });

  it("is checked on every edge and revision route", () => {
    const api = resolve(process.cwd(), "server/api");
    const files = ["edges", "revisions"].flatMap((dir) =>
      readdirSync(`${api}/${dir}`, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts"))
        .map((file) => `${dir}/${file}`),
    );

    expect(Object.keys(routes).sort()).toEqual(files.sort());
    expect(routes["edges/index.get.ts"]).toBeNull();
    expect(edgesIndex).not.toHaveProperty("default");
  });

  it.each(writes)("stays out of what %s answers", (file) => {
    expect(answers.get(file)?.length).toBeGreaterThan(0);
    expect(privateFieldsIn(answers.get(file))).toEqual([]);
  });

  it.each(Object.keys(reads))("stays out of what %s answers", async (file) => {
    for (const { call: request, shows } of reads[file]!()) {
      const answer = await call(file, request);
      expect(shows(answer), JSON.stringify(request)).toBeTruthy();
      expect(privateFieldsIn(answer)).toEqual([]);
    }
  });

  it("stays out of every revision the writes filed", () => {
    const revisions = [...db.documents("revisions").values()];
    expect(revisions.length).toBeGreaterThan(8);
    for (const revision of revisions) {
      expect(revision.data).not.toHaveProperty("declared");
      expect(revision.data).not.toHaveProperty("as_of");
    }
  });

  it("stays on the edges, whatever was written over them", () => {
    const stored = (id: string) => db.stored(db.doc(`edges/${id}`))!;
    // The older proposal is approved, and the later entry is still there.
    expect(stored("post")).toMatchObject({
      start_date: "2019-11-20",
      published: true,
      as_of: "2025",
      declared: { [FIRST]: entry("2024"), [LATER]: entry("2025") },
    });
    expect(stored("seat")).toMatchObject({
      end_date: "2025-06-30",
      declared: {
        "c0de-p1:employer:0": entry("2024", { role: "prezes zarządu" }),
      },
    });
    // A removal keeps the document, and with it what declarations said.
    expect(stored("gone")).toMatchObject({
      deleted: true,
      as_of: "2023",
      declared: { "d00d-p1:employer:0": entry("2023", { role: "sekretarz" }) },
    });
  });
});
