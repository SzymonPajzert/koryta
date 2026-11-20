import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import {
  nameVotes,
  scanMyVotes,
  VOTES_SCAN_CAP,
} from "../../../server/utils/myVotes";

type Data = Record<string, unknown>;

const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

function snapshotOf(id: string, data: Data | undefined) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  };
}

type Snapshot = ReturnType<typeof snapshotOf>;

/** A query over `docs` that does what Firestore would: `==` drops documents
 * without the field, and so does every `orderBy`, which is what keeps the
 * votes on facts out. Each clause is also recorded. */
function queryOver(docs: Snapshot[], order: [string, "asc" | "desc"][] = []) {
  const sorted = () =>
    [...docs].sort((a, b) => {
      for (const [field, direction] of order) {
        const left = String(a.get(field));
        const right = String(b.get(field));
        if (left === right) continue;
        const ascending = left < right ? -1 : 1;
        return direction === "desc" ? -ascending : ascending;
      }
      return 0;
    });
  return {
    where(field: string, op: string, value: unknown) {
      mockWhere(field, op, value);
      if (op !== "==") throw new Error(`the fake only knows "==", not "${op}"`);
      return queryOver(
        docs.filter((doc) => {
          const data = doc.data() ?? {};
          return field in data && data[field] === value;
        }),
        order,
      );
    },
    orderBy(field: string, direction: "asc" | "desc" = "asc") {
      mockOrderBy(field, direction);
      return queryOver(
        docs.filter((doc) => field in (doc.data() ?? {})),
        [...order, [field, direction]],
      );
    },
    select() {
      return queryOver(docs, order);
    },
    limit(count: number) {
      mockLimit(count);
      return queryOver(sorted().slice(0, count), order);
    },
    get: async () => {
      const rows = sorted();
      return { docs: rows, size: rows.length, empty: rows.length === 0 };
    },
  };
}

let votes: Record<string, Data> = {};
let nodes: Record<string, Data> = {};

const mockGetAll = vi.fn(async (...args: unknown[]) =>
  args
    .filter(
      (arg): arg is { id: string } =>
        !!arg && typeof (arg as { path?: unknown }).path === "string",
    )
    .map((ref) => snapshotOf(ref.id, nodes[ref.id])),
);

const db = {
  collection: (name: string) => ({
    ...queryOver(
      name === "votes"
        ? Object.entries(votes).map(([id, data]) => snapshotOf(id, data))
        : [],
    ),
    doc: (id: string) => ({ id, path: `${name}/${id}` }),
  }),
  getAll: mockGetAll,
} as unknown as Firestore;

/** A vote by "me" on a person, `hoursAgo` before noon on 2026-11-20. */
const vote = (
  nodeId: string,
  value: number,
  hoursAgo: number,
  over: Data = {},
) => ({
  [`${nodeId}_me`]: {
    nodeId,
    userUid: "me",
    categoryVotes: { interesting: value },
    updatedAt: new Date(
      Date.UTC(2026, 10, 20, 12) - hoursAgo * 3_600_000,
    ).toISOString(),
    ...over,
  },
});

describe("scanMyVotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    votes = {};
    nodes = {};
  });

  it("reads one user's votes on people, newest first", async () => {
    votes = {
      ...vote("anna", 3, 5),
      ...vote("jan", -2, 1),
      jan_other: {
        nodeId: "jan",
        userUid: "other",
        categoryVotes: { interesting: 5 },
        updatedAt: "2026-11-20T11:30:00.000Z",
      },
    };

    const result = await scanMyVotes(db, "me");

    expect(result).toEqual({
      votes: [
        { nodeId: "jan", value: -2, updatedAt: "2026-11-20T11:00:00.000Z" },
        { nodeId: "anna", value: 3, updatedAt: "2026-11-20T07:00:00.000Z" },
      ],
      truncated: false,
    });
    expect(mockWhere).toHaveBeenCalledWith("userUid", "==", "me");
    expect(mockLimit).toHaveBeenCalledWith(VOTES_SCAN_CAP);
  });

  it("leaves out a rated fact, a vote taken back and a vote in another category", async () => {
    votes = {
      ...vote("anna", 3, 5),
      ...vote("jan", 0, 2),
      ...vote("ewa", 0, 3, { categoryVotes: { quality: 1 } }),
      "fact-1_me": {
        extractionId: "fact-1",
        userUid: "me",
        categoryVotes: { interesting: 2 },
        updatedAt: "2026-11-20T11:59:00.000Z",
      },
    };

    const result = await scanMyVotes(db, "me");

    expect(result.votes.map((row) => row.nodeId)).toEqual(["anna"]);
  });

  it("says when the scan stopped at its cap", async () => {
    for (let i = 0; i < VOTES_SCAN_CAP; i++) {
      Object.assign(votes, vote(`p${i}`, 1, i));
    }

    expect((await scanMyVotes(db, "me")).truncated).toBe(true);
  });

  it("asks for the order the composite index in firestore.indexes.json holds", async () => {
    await scanMyVotes(db, "me");

    expect(mockOrderBy.mock.calls).toEqual([
      ["updatedAt", "desc"],
      ["nodeId", "asc"],
    ]);

    const path = existsSync(resolve(process.cwd(), "firestore.indexes.json"))
      ? resolve(process.cwd(), "firestore.indexes.json")
      : resolve(process.cwd(), "..", "firestore.indexes.json");
    const indexes = (
      JSON.parse(readFileSync(path, "utf8")).indexes as {
        collectionGroup: string;
        fields: { fieldPath: string; order: string }[];
      }[]
    )
      .filter((index) => index.collectionGroup === "votes")
      .map((index) =>
        index.fields.map((f) => `${f.fieldPath} ${f.order}`).join(", "),
      );
    expect(indexes).toContain(
      "userUid ASCENDING, updatedAt DESCENDING, nodeId ASCENDING",
    );
  });
});

describe("nameVotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodes = {};
  });

  it("names the people voted on and links their pages", async () => {
    nodes = { anna: { name: "Anna Nowak", type: "person" } };

    const named = await nameVotes(db, [
      { nodeId: "anna", value: 3, updatedAt: "2026-11-20T07:00:00.000Z" },
    ]);

    expect(named).toEqual([
      {
        nodeId: "anna",
        name: "Anna Nowak",
        path: "/osoba/anna-nowak-anna",
        value: 3,
        updatedAt: "2026-11-20T07:00:00.000Z",
      },
    ]);
    // Only the two fields the row reads.
    expect(mockGetAll.mock.calls[0]?.at(-1)).toEqual({
      fieldMask: ["name", "type"],
    });
  });

  it("keeps a vote on a page that is gone, without a name or a link", async () => {
    const [row] = await nameVotes(db, [
      { nodeId: "gone", value: 2, updatedAt: "2026-11-20T07:00:00.000Z" },
    ]);

    expect(row).toMatchObject({ nodeId: "gone", name: null, path: null });
  });

  it("reads nothing for a page with no votes on it", async () => {
    expect(await nameVotes(db, [])).toEqual([]);
    expect(mockGetAll).not.toHaveBeenCalled();
  });
});
