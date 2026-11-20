import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MemoryTimestamp,
  memoryFirestoreModule,
  sharedMemoryFirestore,
} from "../memoryFirestore";
import { DECLARATION_ACTOR } from "../../../shared/declarations";
import { approveWaitingEdge } from "../../../server/utils/edgePublication";
import teaser from "../../../server/api/nodes/[id]/teaser.get";
import successions from "../../../server/api/edges/successions.get";
import computeNodes from "../../../server/api/stats/computeNodes.post";
import type { StoredSearchLines } from "../../../shared/model";

/**
 * A post a declaration created is the readers' word until somebody vouches for
 * it. A logged out reader sees an unpublished person's posts that an import
 * wrote or a reviewer approved - on the teaser of the page, in „Obecny skład”
 * of the company and in the line under the name in the search box - and this
 * one only once `approveWaitingEdge` has approved it.
 */

type TestEvent = {
  query: Record<string, unknown>;
  params: Record<string, string>;
  headers: Record<string, string>;
  context: Record<string, unknown>;
};

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  const g = globalThis as Any;
  g.defineEventHandler = (fn: Any) => fn;
  g.defineCachedFunction = (fn: Any) => fn;
  g.createError = (error: Any) =>
    Object.assign(new Error(error.message ?? error.statusMessage), error);
  g.getQuery = (event: Any) => event.query;
  g.setResponseHeader = () => {};
  g.useStorage = () => ({
    getKeys: async () => [],
    removeItem: async () => {},
    clear: async () => {},
  });
});

vi.mock("firebase-admin/firestore", () =>
  memoryFirestoreModule(sharedMemoryFirestore()),
);
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getRouterParam: (event: TestEvent, name: string) => event.params[name],
}));
// The recount is an admin's; the pages are asked by somebody logged out.
vi.mock("../../../server/utils/auth", () => ({
  getUser: async () => ({ uid: "admin-1", admin: true }),
}));
vi.mock("../../../server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => fn,
  editorFreshCachedEventHandler: (fn: unknown) => fn,
  wantsLatest: async () => false,
}));

const db = sharedMemoryFirestore();

const ask = (
  handler: (event: never) => unknown,
  request: Partial<TestEvent> = {},
) =>
  handler({
    query: {},
    params: {},
    headers: {},
    context: {},
    ...request,
  } as never) as Promise<Record<string, unknown>>;

/** The teaser of her page: which post it names, and how many it counts. */
async function teaserOfAnna() {
  const answer = await ask(teaser, { params: { id: "anna" } });
  return {
    post: (answer.post as { id: string } | undefined)?.id,
    count: answer.employmentCount,
  };
}

/** Who „Obecny skład” of the starostwo names, by the edge behind each. */
async function boardOfStarostwo() {
  const answer = await ask(successions, { query: { companyId: "starostwo" } });
  return (answer.current as { edgeId: string }[]).map((post) => post.edgeId);
}

/** The line a logged out reader is shown under her name in the search box. */
async function searchLineOfAnna() {
  await ask(computeNodes);
  const stats = db.stored(db.doc("nodes/anna"))!.stats as {
    searchLine?: StoredSearchLines;
  };
  return stats.searchLine?.teaser;
}

const at = (day: string) => MemoryTimestamp.fromDate(new Date(day));

/** Anna's page is a draft the people import wrote; she has a register post
 * that ended, and a declaration says she is wicestarosta now. */
function seed() {
  db.clear();
  const declared = {
    type: "employed",
    source: "anna",
    target: "starostwo",
    name: "wicestarosta",
  };
  const register = {
    type: "employed",
    source: "anna",
    target: "spolka",
    name: "Zarząd",
    start_date: "2016-01-01",
    end_date: "2020-01-01",
  };
  const imported = {
    collection: "edges",
    update_user: "pipeline-people-import",
    update_automatic: true,
    status: "pending",
    update_time: at("2026-10-01"),
  };
  db.seed({
    "nodes/anna": { type: "person", name: "Anna Nowak", published: false },
    "revisions/anna-rev": {
      ...imported,
      collection: "nodes",
      node_id: "anna",
      data: { type: "person", name: "Anna Nowak" },
    },
    "nodes/starostwo": {
      type: "place",
      name: "Starostwo Powiatowe w Jaśle",
      published: true,
      isPublic: true,
    },
    "nodes/spolka": {
      type: "place",
      name: "MZGK Bolesławiec",
      published: true,
      isPublic: true,
    },
    "edges/register": { ...register, published: false },
    "revisions/register-rev": {
      ...imported,
      node_id: "register",
      data: register,
    },
    "edges/declared": {
      ...declared,
      published: false,
      as_of: "2025",
      declared: {
        "f00d-p1:employer:0": {
          url: "https://bip.example.pl/oswiadczenie.pdf",
          as_of: "2025",
          kind: "annual",
          band: "employer",
          role: "wicestarosta",
          roleId: "wicestarosta",
          by: "readers",
          readers: 2,
          at: "2026-11-19T12:00:00.000Z",
        },
      },
    },
    "revisions/declared-rev": {
      node_id: "declared",
      collection: "edges",
      data: declared,
      update_user: DECLARATION_ACTOR,
      update_automatic: true,
      status: "pending",
      update_time: at("2026-11-19"),
    },
  });
}

/** What `approveWaitingEdge` does for the post once its page may show it. */
async function approve() {
  const batch = db.batch();
  const approved = await approveWaitingEdge(
    db as never,
    batch as never,
    "declared",
    db.stored(db.doc("edges/declared"))!,
    { uid: DECLARATION_ACTOR },
  );
  await batch.commit();
  return approved;
}

describe("a post a declaration created, before it is approved", () => {
  beforeEach(seed);

  it("is neither named nor counted on the teaser", async () => {
    expect(await teaserOfAnna()).toEqual({ post: "register", count: 1 });
  });

  it("is not in „Obecny skład”", async () => {
    expect(await boardOfStarostwo()).toEqual([]);
  });

  it("is not the line under her name in the search box", async () => {
    expect(await searchLineOfAnna()).toMatchObject({
      what: "MZGK Bolesławiec",
      ties: ["spolka"],
    });
  });
});

describe("a post a declaration created, once approveWaitingEdge has approved it", () => {
  beforeEach(async () => {
    seed();
    expect(await approve()).toBe(true);
  });

  it("is the post the teaser names", async () => {
    expect(await teaserOfAnna()).toEqual({ post: "declared", count: 2 });
  });

  it("is in „Obecny skład”", async () => {
    expect(await boardOfStarostwo()).toEqual(["declared"]);
  });

  it("is the line under her name in the search box", async () => {
    expect(await searchLineOfAnna()).toMatchObject({
      what: "Starostwo Powiatowe w Jaśle",
      ties: ["starostwo"],
    });
  });
});
