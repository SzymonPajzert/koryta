import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/succession-chain.get";
import type { SuccessionChainStep } from "../../../../server/api/edges/succession-chain.get";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

/** A query over `edges` built the way the endpoint builds it: equality filters
 * and one `in`, with no ordering - the pairing sorts its own results, so the
 * fake does not have to model an index. The same fake as
 * `successions.test.ts`, because the two handlers read the collection the same
 * way and a second, subtly different one would be a place for them to drift. */
function edgeQuery() {
  const filters: [string, string, unknown][] = [];

  const query = {
    where: vi.fn((field: string, op: string, value: unknown) => {
      filters.push([field, op, value]);
      return query;
    }),
    limit: vi.fn(() => query),
    get: vi.fn(async () => {
      const docs = Object.entries(edges)
        .filter(([, data]) =>
          filters.every(([field, op, value]) =>
            op === "in"
              ? (value as unknown[]).includes(data[field])
              : data[field] === value,
          ),
        )
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }),
  };
  return query;
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({ id, path: `${collection}/${id}` })),
    where: vi.fn((field: string, op: string, value: unknown) =>
      edgeQuery().where(field, op, value),
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

/** `wantsLatest` is a variable here rather than the constant `false` it is in
 * `successions.test.ts`. Almost nobody the register knows about has a
 * published page, so on this endpoint the redacted answer and the editor's
 * answer are two different products and both have to be pinned - and the
 * signed-in one is the one the chain page actually ships. */
const { latest } = vi.hoisted(() => ({ latest: { wanted: false } }));

vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => latest.wanted,
}));

const { mockGetQuery } = vi.hoisted(() => {
  const mockGetQuery = vi.fn(() => ({}) as Record<string, unknown>);
  globalThis.getQuery = mockGetQuery as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetQuery };
});

function call(query: Record<string, unknown>): Promise<SuccessionChainStep> {
  mockGetQuery.mockReturnValue(query);
  return handler({} as never) as Promise<SuccessionChainStep>;
}

/** One employment spell. Defaults to Grobelny's seat on the board of Związek
 * Miast Polskich, which is the shape every assertion here is a variation on. */
function spell(fields: Record<string, unknown>) {
  return {
    source: "grobelny",
    target: "zmp",
    type: "employed",
    name: "Zarząd",
    published: true,
    ...fields,
  };
}

describe("api/edges/succession-chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latest.wanted = false;
    nodes = {
      grobelny: {
        name: "Ryszard Grobelny",
        type: "person",
        published: true,
      },
      // Stored as a numbered-key object, which is what
      // `sanitizeFirestoreData` wrote until 2026-07-28 and what `asArray`
      // exists to read. `?? []` would hand the client `{"0": "PSL"}` typed as
      // a string array.
      rozpara: {
        name: "Tadeusz Rozpara",
        type: "person",
        published: true,
        parties: { "0": "PSL" },
      },
      lewandowski: {
        name: "Tomasz Jacek Lewandowski",
        type: "person",
        published: true,
      },
      samotny: { name: "Samotny Radny", type: "person", published: true },
      zmp: {
        name: "Związek Miast Polskich",
        type: "place",
        published: true,
      },
      mtp: {
        name: "Międzynarodowe Targi Poznańskie",
        type: "place",
        published: true,
      },
      szpital: {
        name: "Szpital w Gnieźnie",
        type: "place",
        published: true,
        supervisoryBody: "rada-spoleczna",
      },
    };
    edges = {
      // Związek Miast Polskich: the whole board changed on 4 June 2003.
      zmp1: spell({ start_date: "2003-06-04", end_date: "2015-06-01" }),
      zmp2: spell({
        source: "rozpara",
        start_date: "2001-12-06",
        end_date: "2003-06-04",
      }),
      // Międzynarodowe Targi Poznańskie: a supervisory seat, handed on three
      // weeks after it was vacated.
      mtp1: spell({
        target: "mtp",
        name: "Rada Nadzorcza",
        start_date: "2004-04-13",
        end_date: "2016-08-16",
      }),
      mtp2: spell({
        source: "lewandowski",
        target: "mtp",
        name: "Rada Nadzorcza",
        start_date: "2016-09-08",
        end_date: null,
      }),
    };
  });

  it("merges both companies into one pair of columns", async () => {
    // The example the feature exists for: the predecessor a reader expects is
    // at Związek Miast Polskich and the successor at Międzynarodowe Targi
    // Poznańskie. An answer grouped by company puts the two halves of one
    // question on two different screens, so the columns are flat and the
    // company travels on the card as provenance.
    const step = await call({ personId: "grobelny" });

    expect(step.personName).toBe("Ryszard Grobelny");
    expect(step.predecessors.map((c) => c.personName)).toEqual([
      "Tadeusz Rozpara",
    ]);
    expect(step.successors.map((c) => c.personName)).toEqual([
      "Tomasz Jacek Lewandowski",
    ]);
    expect(step.predecessors[0]!.via).toHaveLength(1);
    expect(step.predecessors[0]!.via[0]!.companyName).toBe(
      "Związek Miast Polskich",
    );
    expect(step.predecessors[0]!.via[0]!.gapDays).toBe(0);
    expect(step.predecessors[0]!.via[0]!.batchSize).toBe(1);
    expect(step.predecessors[0]!.parties).toEqual(["PSL"]);
    expect(step.successors[0]!.via[0]!.companyName).toBe(
      "Międzynarodowe Targi Poznańskie",
    );
    expect(step.successors[0]!.via[0]!.gapDays).toBe(23);
    expect(step.successors[0]!.closestGapDays).toBe(23);
    expect(step.hidden).toBe(0);

    // The posts are the other axis of the same answer: one row per seat this
    // person held, newest first, saying how many people the register allows
    // either side of it.
    expect(
      step.posts.map((p) => [
        p.companyName,
        p.role,
        p.predecessorCount,
        p.successorCount,
      ]),
    ).toEqual([
      ["Międzynarodowe Targi Poznańskie", "Rada Nadzorcza", 0, 1],
      ["Związek Miast Polskich", "Zarząd", 1, 0],
    ]);
  });

  it("withholds a neighbour with no page, and names them for an editor", async () => {
    nodes.lewandowski!.published = false;

    const redacted = await call({ personId: "grobelny" });
    expect(redacted.successors).toEqual([]);
    expect(redacted.hidden).toBe(1);
    // The post still says the seat changed hands - it just cannot say to whom.
    expect(redacted.posts[0]!.successorCount).toBe(0);

    latest.wanted = true;
    const full = await call({ personId: "grobelny" });
    expect(full.successors.map((c) => c.personName)).toEqual([
      "Tomasz Jacek Lewandowski",
    ]);
    expect(full.successors[0]!.published).toBe(false);
    expect(full.hidden).toBe(0);
  });

  it("keeps a post the register gave no role, with nobody either side", async () => {
    // Not the same fact as "we found nobody": a spell with no role cannot be
    // matched to anybody at all, and dropping it would tell a reader the post
    // does not exist.
    edges.zmp3 = spell({
      name: "",
      start_date: "1998-01-01",
      end_date: "2001-01-01",
    });

    const step = await call({ personId: "grobelny" });

    const bezFunkcji = step.posts.find((p) => p.start === "1998-01-01");
    expect(bezFunkcji?.role).toBeNull();
    expect(bezFunkcji?.predecessorCount).toBe(0);
    expect(bezFunkcji?.successorCount).toBe(0);
  });

  it("answers for somebody with no posts at all", async () => {
    // A failed expansion is a card in a chain, not a broken page, so this is
    // an empty answer rather than a 404 - and it still carries the name, so
    // the chain can draw the person it could not grow from.
    const step = await call({ personId: "samotny" });

    expect(step).toEqual({
      personId: "samotny",
      personName: "Samotny Radny",
      parties: [],
      published: true,
      posts: [],
      predecessors: [],
      successors: [],
      hidden: 0,
    });
  });

  it("names the hospital's own organ rather than the stored role", async () => {
    edges = {
      s1: spell({
        target: "szpital",
        name: "Rada Nadzorcza",
        start_date: "2018-01-01",
        end_date: "2021-01-01",
      }),
      s2: spell({
        source: "rozpara",
        target: "szpital",
        name: "Rada Nadzorcza",
        start_date: "2021-01-01",
        end_date: null,
      }),
    };

    const step = await call({ personId: "grobelny" });

    expect(step.posts[0]!.role).toBe("Rada Społeczna");
    expect(step.successors[0]!.via[0]!.role).toBe("Rada Społeczna");
  });

  it("counts one person at two companies as one candidate with two reasons", async () => {
    // One human is one node in the chain. Two cards with one name on them
    // reads as a bug, and it would give the expansion two keys for one person.
    edges.mtp3 = spell({
      source: "rozpara",
      target: "mtp",
      name: "Rada Nadzorcza",
      start_date: "2000-01-01",
      end_date: "2004-04-13",
    });

    const step = await call({ personId: "grobelny" });

    expect(step.predecessors).toHaveLength(1);
    expect(step.predecessors[0]!.personId).toBe("rozpara");
    expect(step.predecessors[0]!.via.map((v) => v.companyName)).toEqual([
      "Międzynarodowe Targi Poznańskie",
      "Związek Miast Polskich",
    ]);
    expect(step.predecessors[0]!.via.map((v) => v.gapDays)).toEqual([0, 0]);
    expect(step.predecessors[0]!.closestGapDays).toBe(0);
  });

  it("says nothing at all about somebody with no page of their own", async () => {
    // The redaction the rest of the site makes, applied to the person in the
    // middle: this would otherwise be the one surface that prints an
    // unapproved person's whole career - and everybody either side of it - to
    // a logged out reader. The empty name is what the chain draws its own
    // "nie znaleźliśmy" card from; it is not a 404, because a failed
    // expansion is one card and not a broken page.
    nodes.grobelny!.published = false;

    expect(await call({ personId: "grobelny" })).toEqual({
      personId: "grobelny",
      personName: "",
      parties: [],
      published: false,
      posts: [],
      predecessors: [],
      successors: [],
      hidden: 0,
    });

    latest.wanted = true;
    const forEditor = await call({ personId: "grobelny" });
    expect(forEditor.personName).toBe("Ryszard Grobelny");
    expect(forEditor.published).toBe(false);
    expect(forEditor.posts).toHaveLength(2);
  });

  it("refuses a request that names nobody", async () => {
    await expect(call({})).rejects.toMatchObject({
      statusCode: 400,
      message: "Podaj personId",
    });
  });
});
