import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/teaser.get";

/** Node documents, keyed by id. */
let nodes: Record<string, Record<string, unknown>> = {};
/** Edge documents, keyed by id. */
let edges: Record<string, Record<string, unknown>> = {};
/** Where `resolveMergedNode` sends a duplicate. */
let mergedInto: Record<string, string> = {};
/** The `where` clauses the edge query was built with. */
let edgeFilters: [string, string, unknown][] = [];

const nodeRef = (id: string) => ({
  id,
  get: async () => snapshot(id),
});
const snapshot = (id: string) => ({
  id,
  exists: nodes[id] !== undefined,
  data: () => nodes[id],
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({
    collection: (name: string) => {
      if (name === "nodes") return { doc: nodeRef };
      const query = {
        where: (field: string, op: string, value: unknown) => {
          edgeFilters.push([field, op, value]);
          return query;
        },
        get: async () => ({
          docs: Object.entries(edges)
            .filter(([, edge]) =>
              edgeFilters.every(
                ([field, , value]) =>
                  (edge as Record<string, unknown>)[field] === value,
              ),
            )
            .map(([id, edge]) => ({ id, data: () => edge })),
        }),
      };
      return query;
    },
    getAll: async (...refs: { id: string }[]) =>
      refs.map((ref) => snapshot(ref.id)),
  })),
}));
vi.mock("../../../../server/utils/merge", () => ({
  resolveMergedNode: async (_db: unknown, id: string) => {
    const resolved = mergedInto[id] ?? id;
    return {
      id: resolved,
      snapshot: nodes[resolved] ? snapshot(resolved) : undefined,
    };
  },
}));

/** Documents a contributor wrote and nobody reviewed - see
 * `importedOrReviewed`, which has tests of its own. */
const proposed = vi.hoisted(() => new Set<string>());
vi.mock("../../../../server/utils/provenance", () => ({
  importedOrReviewed: async (_db: unknown, docs: { id?: string }[]) =>
    new Set(
      docs
        .map((doc) => doc.id)
        .filter((id): id is string => !!id && !proposed.has(id)),
    ),
}));

const params = vi.hoisted(() => ({ id: "p1" }));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getRouterParam: () => params.id,
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedEventHandler = (fn: any) => fn;
  globalThis.setResponseHeader = () => {};
});

const call = (id = "p1") => {
  params.id = id;
  edgeFilters = [];
  return handler({ context: {}, headers: {} } as never) as Promise<
    Record<string, unknown>
  >;
};

describe("/api/nodes/[id]/teaser", () => {
  beforeEach(() => {
    mergedInto = {};
    proposed.clear();
    nodes = {
      p1: {
        type: "person",
        name: "Jan Kowalski",
        published: false,
        parties: ["PiS"],
        partiesSource: "manual",
        birthDate: "1970-01-01",
        rejestrIo: "https://rejestr.io/osoby/1",
      },
      c1: { type: "place", name: "ENERGA", published: true },
      gmina: { type: "place", name: "Urząd Gminy", published: false },
    };
    edges = {
      job: {
        type: "employed",
        source: "p1",
        target: "c1",
        name: "Prezes Zarządu",
        start_date: "2023-02-01",
        published: false,
      },
      older: {
        type: "employed",
        source: "p1",
        target: "gmina",
        name: "Sekretarz",
        start_date: "2010-01-01",
        end_date: "2018-01-01",
      },
      candidacy: {
        type: "election",
        source: "p1",
        target: "gmina",
        party: "PiS",
        committee: "KW Prawo i Sprawiedliwość",
        start_date: "2024-04-07",
      },
    };
  });

  it("names an unpublished person and their most recent post", async () => {
    expect(await call()).toEqual({
      id: "p1",
      name: "Jan Kowalski",
      employment: {
        role: "Prezes Zarządu",
        companyId: "c1",
        companyName: "ENERGA",
        companyPublished: true,
        start: "2023-02-01",
      },
      employmentCount: 2,
    });
  });

  it("never sends the party, a candidacy or anything else on the page", async () => {
    // The party on an unpublished person is a PKW match nobody has checked.
    const body = JSON.stringify(await call());
    expect(body).not.toContain("PiS");
    expect(body).not.toContain("Prawo i Sprawiedliwość");
    expect(body).not.toContain("1970");
    expect(body).not.toContain("rejestr.io");
    // Asked for employment alone, so a candidacy is not even read.
    expect(edgeFilters).toEqual([
      ["source", "==", "p1"],
      ["type", "==", "employed"],
    ]);
  });

  it("answers for the person a duplicate was merged into", async () => {
    mergedInto = { dup: "p1" };
    const teaser = await call("dup");
    expect(teaser.id).toBe("p1");
    expect(teaser.name).toBe("Jan Kowalski");
  });

  it("is a 404 for a removed person, a company and an unknown id", async () => {
    nodes.p1 = { ...nodes.p1, deleted: true };
    await expect(call("p1")).rejects.toMatchObject({ statusCode: 404 });
    await expect(call("c1")).rejects.toMatchObject({ statusCode: 404 });
    await expect(call("nobody")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("is a 404 for a person somebody proposed and nobody reviewed", async () => {
    // Anybody with an account can propose a person; their name is not the
    // site's to show until a reviewer has looked.
    proposed.add("p1");
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("neither names nor counts a post somebody added", async () => {
    // The newest post is a contributor's claim: the register's older one is
    // what the teaser names.
    proposed.add("job");
    expect(await call()).toMatchObject({
      employment: { companyId: "gmina", role: "Sekretarz" },
      employmentCount: 1,
    });
  });

  it("says nothing about employment for a person with none", async () => {
    edges = {};
    expect(await call()).toEqual({
      id: "p1",
      name: "Jan Kowalski",
      employmentCount: 0,
    });
  });
});
