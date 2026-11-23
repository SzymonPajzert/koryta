import { describe, it, expect, vi, beforeEach } from "vitest";
import { ListMemo, readMatching } from "../../../server/utils/nodeScan";
import type { NodeFilterOp } from "../../../server/utils/nodeFilters";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({
  logger: { warn, error: vi.fn(), info: vi.fn() },
}));

type Clause = { field: string; op: string; value: unknown };
type Data = Record<string, unknown>;

function getPath(data: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, key) => (o as Data | undefined)?.[key], data);
}

function matches(data: Data, clause: Clause): boolean {
  const value = getPath(data, clause.field);
  if (clause.op === "==") return value === clause.value;
  if (clause.op === "array-contains-any") {
    return (
      Array.isArray(value) &&
      value.some((v) => (clause.value as unknown[]).includes(v))
    );
  }
  throw new Error(`the fake does not know ${clause.op}`);
}

/** Firestore over a list of documents: evaluates the clauses, honours
 * `select`, records every query it ran, and refuses the ones `rejects` names
 * the way a missing composite index does. */
function fakeDb(
  docs: { id: string; data: Data }[],
  rejects: (clauses: Clause[]) => boolean = () => false,
) {
  const queries: Clause[][] = [];
  function query(clauses: Clause[], selected?: string[]): unknown {
    return {
      where: (field: string, op: string, value: unknown) =>
        query([...clauses, { field, op, value }], selected),
      select: (...fields: string[]) => query(clauses, fields),
      get: async () => {
        queries.push(clauses);
        if (rejects(clauses)) {
          throw Object.assign(
            new Error("9 FAILED_PRECONDITION: The query requires an index."),
            { code: 9 },
          );
        }
        return {
          docs: docs
            .filter((doc) => clauses.every((c) => matches(doc.data, c)))
            .map((doc) => ({
              id: doc.id,
              data: () =>
                selected
                  ? Object.fromEntries(
                      selected.map((f) => [f, getPath(doc.data, f)]),
                    )
                  : doc.data,
            })),
        };
      },
    };
  }
  const db = {
    collection: () => query([]),
  } as unknown as FirebaseFirestore.Firestore;
  return { db, queries };
}

function eqOp(
  field: string,
  value: unknown,
  extra: Partial<NodeFilterOp> = {},
) {
  return {
    applyFs: (q: FirebaseFirestore.Query) => q.where(field, "==", value),
    applyMem: (nodes: Data[]) =>
      nodes.filter((n) => getPath(n, field) === value),
    fields: [field],
    ...extra,
  } satisfies NodeFilterOp;
}

const typeOp = eqOp("type", "person", { name: "type", base: true });
const approvedOp = eqOp("stats.isApproved", true, {
  name: "visibility",
  base: true,
});
const TARGETS = "stats.edges.approved.targetNodeIds";

function wideOp(values: string[]): NodeFilterOp {
  const wanted = new Set(values);
  return {
    applyFs: () => {
      throw new Error("index: filter not supported in Firestore query");
    },
    applyMem: (nodes) =>
      nodes.filter((n) =>
        ((getPath(n, TARGETS) as string[] | undefined) ?? []).some((id) =>
          wanted.has(id),
        ),
      ),
    fields: [TARGETS],
    name: "teryt",
    memoryOnly: true,
    wide: { field: TARGETS, values },
  };
}

function person(id: string, targets: string[], approved = true) {
  return {
    id,
    data: {
      type: "person",
      name: id,
      stats: {
        isApproved: approved,
        edges: { approved: { targetNodeIds: targets } },
      },
    },
  };
}

const regions = (n: number) =>
  Array.from({ length: n }, (_, i) => `teryt14${String(i).padStart(2, "0")}`);

describe("readMatching, a wide op", () => {
  beforeEach(() => warn.mockClear());

  it("asks thirty values a query and reads only the people tied to them", async () => {
    const ids = regions(65);
    const { db, queries } = fakeDb([
      person("a", [ids[0]!]),
      // Tied to places in two chunks: one row, not two.
      person("b", [ids[1]!, ids[64]!]),
      person("c", ["teryt0201"]),
      person("d", [ids[40]!], false),
    ]);

    const read = await readMatching(db, [typeOp, wideOp(ids), approvedOp], {
      label: "test",
    });

    expect(read.how).toBe("chunks");
    expect(read.docs.map((d) => d.id)).toEqual(["a", "b"]);
    expect(queries).toHaveLength(3);
    for (const clauses of queries) {
      expect(clauses.slice(0, 2)).toEqual([
        { field: "type", op: "==", value: "person" },
        { field: "stats.isApproved", op: "==", value: true },
      ]);
      const chunk = clauses[2]!;
      expect(chunk.op).toBe("array-contains-any");
      expect((chunk.value as string[]).length).toBeLessThanOrEqual(30);
    }
    expect(queries.flatMap((c) => c[2]!.value as string[]).sort()).toEqual(
      [...ids].sort(),
    );
    expect(read.inFirestore).toEqual(["type", "visibility", "teryt"]);
  });

  it("drops the published flag from the chunks when Firestore has no index for it", async () => {
    const ids = regions(40);
    const { db } = fakeDb(
      [person("a", [ids[0]!]), person("draft", [ids[1]!], false)],
      (clauses) =>
        clauses.some((c) => c.field === "stats.isApproved") &&
        clauses.some((c) => c.op === "array-contains-any"),
    );

    const read = await readMatching(db, [typeOp, wideOp(ids), approvedOp], {
      label: "test",
    });

    // The caller applies every op in memory, the published flag included.
    expect(read.docs.map((d) => d.id)).toEqual(["a", "draft"]);
    expect(read.inFirestore).toEqual(["type", "teryt"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatchObject({
      error: expect.stringContaining("requires an index"),
    });
  });

  it("reads one page by id whatever else is asked", async () => {
    const { db, queries } = fakeDb([person("a", ["x"]), person("b", ["x"])]);
    const idOp = eqOp("name", "a", { name: "id" });

    const read = await readMatching(db, [idOp, typeOp, wideOp(regions(40))], {
      label: "test",
    });

    expect(read.how).toBe("query");
    expect(queries).toEqual([
      [
        { field: "name", op: "==", value: "a" },
        { field: "type", op: "==", value: "person" },
      ],
    ]);
    expect(read.inFirestore).toEqual(["id", "type"]);
  });

  it("reads the base set once when the chunks would be too many", async () => {
    const { db, queries } = fakeDb([person("a", ["somewhere"])]);

    const read = await readMatching(
      db,
      [typeOp, wideOp(regions(61 * 30)), approvedOp],
      { label: "test" },
    );

    expect(read.how).toBe("query");
    expect(read.inFirestore).toEqual(["type", "visibility"]);
    expect(queries.at(-1)).toEqual([
      { field: "type", op: "==", value: "person" },
      { field: "stats.isApproved", op: "==", value: true },
    ]);
  });
});

describe("readMatching, one query", () => {
  beforeEach(() => warn.mockClear());

  const election: NodeFilterOp = {
    applyFs: () => {
      throw new Error("index: filter not supported in Firestore query");
    },
    applyMem: (nodes) => nodes,
    name: "election",
    memoryOnly: true,
  };

  it("keeps every op it can in the query when one runs in memory only", async () => {
    const { db, queries } = fakeDb([person("a", [])]);

    const read = await readMatching(db, [typeOp, election, approvedOp], {
      label: "test",
    });

    // The memory-only op went last and was the only one dropped, quietly:
    // before, the published flag after it went to memory with it.
    expect(read.inFirestore).toEqual(["type", "visibility"]);
    expect(queries.at(-1)).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("says which op a missing index sent to memory", async () => {
    const voted = eqOp("stats.votes.humanVoted", false, { name: "hideVoted" });
    const { db } = fakeDb([person("a", [])], (clauses) =>
      clauses.some((c) => c.field === "stats.votes.humanVoted"),
    );

    const read = await readMatching(db, [typeOp, approvedOp, voted], {
      label: "api/nodes",
    });

    expect(read.inFirestore).toEqual(["type", "visibility"]);
    expect(warn).toHaveBeenCalledWith(
      "[api/nodes] missing index, hideVoted filtered in memory",
      expect.objectContaining({ shape: "type,visibility,hideVoted" }),
    );
  });

  it("never falls back to reading the whole collection", async () => {
    const { db, queries } = fakeDb([person("a", [])], () => true);

    await expect(
      readMatching(db, [typeOp, approvedOp], { label: "test" }),
    ).rejects.toMatchObject({ code: 9 });
    expect(queries.every((clauses) => clauses.length >= 1)).toBe(true);
  });

  it("asks only for the fields it is given", async () => {
    const { db } = fakeDb([person("a", [])]);

    const read = await readMatching(db, [typeOp], {
      label: "test",
      select: ["type", "stats.isApproved"],
    });

    expect(read.docs[0]!.data()).toEqual({
      type: "person",
      "stats.isApproved": true,
    });
  });
});

describe("ListMemo", () => {
  it("serves a list until it is too old", () => {
    const memo = new ListMemo<number>(1000, 100);
    memo.set("a", [1, 2], 0);
    expect(memo.get("a", 999)).toEqual([1, 2]);
    expect(memo.get("a", 1001)).toBeUndefined();
  });

  it("drops the oldest lists past its bound, and keeps none over it", () => {
    const memo = new ListMemo<number>(1000, 5);
    memo.set("a", [1, 2], 0);
    memo.set("b", [3, 4], 1);
    memo.set("c", [5, 6], 2);
    expect(memo.get("a", 3)).toBeUndefined();
    expect(memo.get("b", 3)).toEqual([3, 4]);
    expect(memo.get("c", 3)).toEqual([5, 6]);

    memo.set("huge", [1, 2, 3, 4, 5, 6], 4);
    expect(memo.get("huge", 5)).toBeUndefined();
    expect(memo.get("c", 5)).toEqual([5, 6]);
  });

  it("counts a list set again once", () => {
    const memo = new ListMemo<number>(1000, 4);
    memo.set("a", [1, 2], 0);
    memo.set("a", [1, 2, 3], 1);
    memo.set("b", [4], 2);
    expect(memo.get("a", 3)).toEqual([1, 2, 3]);
    expect(memo.get("b", 3)).toEqual([4]);
  });
});
