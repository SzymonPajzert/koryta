import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/election-lists.get";
import type { RegionRuns } from "../../../../shared/electionLists";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};
/** The revisions `importedOrReviewed` reads the first of. */
let revisions: Record<string, Record<string, unknown>> = {};

/** A query built the way the endpoint builds it: equality filters over
 * `edges`, and over `revisions` the first by `update_time`. */
function collectionQuery(
  docsOf: () => Record<string, Record<string, unknown>>,
) {
  const filters: [string, unknown][] = [];
  let order: string | undefined;
  let max = Infinity;
  const query = {
    where: vi.fn((field: string, _op: string, value: unknown) => {
      filters.push([field, value]);
      return query;
    }),
    orderBy: vi.fn((field: string) => {
      order = field;
      return query;
    }),
    limit: vi.fn((n: number) => {
      max = n;
      return query;
    }),
    get: vi.fn(async () => {
      const entries = Object.entries(docsOf()).filter(([, data]) =>
        filters.every(([field, value]) => data[field] === value),
      );
      if (order) {
        const key = order;
        entries.sort(([, a], [, b]) =>
          String(a[key]).localeCompare(String(b[key])),
        );
      }
      const docs = entries
        .slice(0, max)
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }),
  };
  return query;
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({
      id,
      get: vi.fn(async () => ({
        id,
        exists: nodes[id] !== undefined,
        data: () => nodes[id],
      })),
    })),
    where: vi.fn((field: string, op: string, value: unknown) =>
      collectionQuery(() =>
        collection === "revisions" ? revisions : edges,
      ).where(field, op, value),
    ),
  })),
  getAll: vi.fn(async (...refs: { id: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: nodes[ref.id] !== undefined,
      data: () => nodes[ref.id],
    })),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

const reader = vi.hoisted(() => ({ signedIn: false }));
vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => reader.signedIn,
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
});
vi.mock("h3", () => ({
  getRouterParam: (event: { id: string }) => event.id,
}));

function call(id = "teryt1061"): Promise<RegionRuns> {
  return handler({ id } as never) as Promise<RegionRuns>;
}

/** A 2024 run in the city, from `person`. */
function run(person: string, fields: Record<string, unknown> = {}) {
  return {
    source: person,
    target: "teryt1061",
    type: "election",
    name: "kandydatura",
    start_date: "2024-01-01",
    position: "Rada miasta",
    committee: "KKW KOALICJA OBYWATELSKA",
    party: "PO",
    elected: true,
    published: true,
    ...fields,
  };
}

/** The first revision of `id`, written by an import or by a person. */
function firstRevision(id: string, automatic: boolean) {
  revisions[`r-${id}`] = {
    node_id: id,
    update_time: "2024-05-01",
    update_automatic: automatic,
  };
}

beforeEach(() => {
  reader.signedIn = false;
  revisions = {};
  nodes = {
    teryt1061: { type: "region", name: "Łódź", published: true },
    pub: {
      type: "person",
      name: "Anna Jawna",
      published: true,
      parties: ["PO"],
    },
    draft: { type: "person", name: "Bogdan Szkic", parties: ["PiS"] },
    hand: { type: "person", name: "Cezary Ręczny" },
    mayor: { type: "person", name: "Dorota Prezydent", published: true },
    gone: { type: "person", name: "Ewa Usunięta", deleted: true },
  };
  edges = {
    e1: run("pub"),
    e2: run("pub", { start_date: "2018-01-01", published: false }),
    e3: run("draft", { published: false }),
    e4: run("hand", { published: false }),
    e5: run("mayor", { position: "Prezydent", published: false }),
    e6: run("gone"),
    e7: run("pub", { deleted: true }),
  };
  firstRevision("draft", true);
  firstRevision("e3", true);
  firstRevision("hand", false);
  firstRevision("e4", true);
  firstRevision("e5", true);
});

describe("GET /api/nodes/[id]/election-lists", () => {
  it("shows a logged out reader published runs and imported drafts, partyless", async () => {
    const answer = await call();
    expect(answer.runs.map((each) => each.edgeId).sort()).toEqual(["e1", "e3"]);
    const draft = answer.runs.find((each) => each.edgeId === "e3")!;
    expect(draft).toMatchObject({
      personName: "Bogdan Szkic",
      published: false,
      parties: [],
      partyHidden: true,
      committee: "KKW KOALICJA OBYWATELSKA",
      party: "PO",
    });
    const published = answer.runs.find((each) => each.edgeId === "e1")!;
    expect(published.parties).toEqual(["PO"]);
    // e2 and e5 are published people's unpublished runs; e4 is a hand-made
    // person's. A removed page and a removed run are not counted at all.
    expect(answer.hidden).toBe(3);
  });

  it("counts the newest election's hidden wins of an imported run, by office", async () => {
    expect((await call()).hiddenElected).toEqual({ Prezydent: 1 });
    // A win somebody wrote by hand holds no seat as awaiting.
    firstRevision("e5", false);
    expect((await call()).hiddenElected).toBeUndefined();
  });

  it("shows an editor everything, with the parties", async () => {
    reader.signedIn = true;
    const answer = await call();
    expect(answer.runs.map((each) => each.edgeId).sort()).toEqual([
      "e1",
      "e2",
      "e3",
      "e4",
      "e5",
    ]);
    expect(answer.runs.find((each) => each.edgeId === "e3")!.parties).toEqual([
      "PiS",
    ]);
    expect(answer.hiddenElected).toBeUndefined();
  });

  it("answers nothing for a region nobody may open, or a node that is not one", async () => {
    nodes.teryt1061 = { type: "region", name: "Łódź", published: false };
    expect(await call()).toEqual({ runs: [], hidden: 0 });
    expect(await call("pub")).toEqual({ runs: [], hidden: 0 });
  });
});
