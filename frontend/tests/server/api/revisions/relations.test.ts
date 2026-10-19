import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, {
  MAX_RELATIONS,
  type NodeRelationHistory,
} from "../../../../server/api/revisions/relations.get";

type Data = Record<string, unknown>;

/** Every document the fake holds, keyed by `<collection>/<id>`. */
let store: Record<string, Data> = {};

const { mockRequireAdmin, mockGetUsers, headers } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  return {
    mockRequireAdmin: vi.fn(),
    mockGetUsers: vi.fn(),
    headers: new Map<string, string>(),
  };
});

const inQueries: unknown[][] = [];

function snapshotOf(id: string, data: Data | undefined) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  };
}

type Snapshot = ReturnType<typeof snapshotOf>;

function docsOf(collection: string): Snapshot[] {
  const prefix = `${collection}/`;
  return Object.entries(store)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, data]) => snapshotOf(path.slice(prefix.length), data));
}

/** Firestore's `==` and `in`: a document without the field matches neither. */
function queryOver(docs: Snapshot[]) {
  return {
    where(field: string, op: string, value: unknown) {
      if (op === "in") inQueries.push(value as unknown[]);
      const matches = (data: Data) => {
        if (!(field in data)) return false;
        if (op === "==") return data[field] === value;
        if (op === "in") return (value as unknown[]).includes(data[field]);
        throw new Error(`the fake does not know "${op}"`);
      };
      return queryOver(docs.filter((doc) => matches(doc.data() ?? {})));
    },
    get: async () => ({ docs, size: docs.length, empty: docs.length === 0 }),
  };
}

const mockDb = {
  collection: (name: string) => ({
    ...queryOver(docsOf(name)),
    doc: (id: string) => ({
      id,
      path: `${name}/${id}`,
      get: async () => snapshotOf(id, store[`${name}/${id}`]),
    }),
  }),
  getAll: vi.fn(async (...args: unknown[]) =>
    args
      .filter(
        (arg): arg is { id: string; path: string } =>
          !!arg && typeof (arg as { path?: unknown }).path === "string",
      )
      .map((ref) => snapshotOf(ref.id, store[ref.path])),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => "now" },
  FieldValue: { delete: () => "DELETED" },
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: mockGetUsers }),
}));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: mockRequireAdmin,
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query?: unknown },
      parse: (q: unknown) => unknown,
    ) => parse(event.query ?? {}),
    setResponseHeader: (_event: unknown, name: string, value: string) =>
      headers.set(name, value),
  };
});

const call = (query: Data = { nodeId: "anna" }) =>
  (handler as unknown as (event: unknown) => Promise<NodeRelationHistory>)({
    query,
  });

const PERSON = { name: "Anna Nowak", type: "person", published: true };

function addEdge(id: string, edge: Data) {
  store[`edges/${id}`] = {
    source: "anna",
    type: "election",
    name: "kandydatura",
    published: true,
    ...edge,
  };
}

function addRevision(id: string, revision: Data) {
  store[`revisions/${id}`] = {
    collection: "edges",
    update_automatic: true,
    update_user: "pipeline-people-import",
    ...revision,
  };
}

describe("api/revisions/relations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = {};
    headers.clear();
    inQueries.length = 0;
    mockRequireAdmin.mockResolvedValue({ uid: "admin-uid", admin: true });
    mockGetUsers.mockResolvedValue({ users: [] });
    store["nodes/anna"] = PERSON;
    store["nodes/teryt0261"] = {
      name: "Jelenia Góra",
      type: "region",
      published: true,
    };
    store["nodes/teryt02"] = {
      name: "dolnośląskie",
      type: "region",
      published: true,
    };
    store["nodes/firma"] = { name: "KARR", type: "place", published: false };
  });

  it("answers an admin only", async () => {
    mockRequireAdmin.mockRejectedValue(
      Object.assign(new Error("tylko admin"), { statusCode: 403 }),
    );

    await expect(call()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockDb.getAll).not.toHaveBeenCalled();
  });

  it("never lets a proxy or the browser keep the answer", async () => {
    await call();

    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("finds the relations at both ends, with each one's revisions", async () => {
    // Papaj's on 2026-10-17: a live candidacy with a proposal the night left,
    // and an article's mention of him, which points at him.
    addEdge("bare-2018", { target: "teryt0261", start_date: "2018-01-01" });
    addRevision("bare-2018-created", {
      node_id: "bare-2018",
      update_time: "2026-03-26T01:45:46.000Z",
      data: {
        source: "anna",
        target: "teryt0261",
        type: "election",
        name: "kandydatura",
        start_date: "2018-01-01",
      },
    });
    addRevision("bare-2018-mayor", {
      node_id: "bare-2018",
      status: "pending",
      update_time: "2026-10-16T14:56:58.000Z",
      data: {
        source: "anna",
        target: "teryt0261",
        type: "election",
        name: "kandydatura",
        start_date: "2018-01-01",
        position: "Prezydent",
        committee: "KWW Zadbajmy o Miasto",
      },
    });
    store["edges/bare-2018"]!.revision_id = "revisions/bare-2018-created";
    store["nodes/artykul"] = { name: "PKW", type: "article", published: true };
    store["edges/mention"] = {
      source: "artykul",
      target: "anna",
      type: "mentions",
      published: true,
    };

    const result = await call();

    const bare = result.relations.find((r) => r.id === "bare-2018")!;
    expect(bare).toMatchObject({
      direction: "outgoing",
      other: { id: "teryt0261", name: "Jelenia Góra", type: "region" },
      state: "proposals",
      waiting: 1,
      approvedRevisionId: "bare-2018-created",
    });
    expect(bare.revisions.map((r) => [r.id, r.status])).toEqual([
      ["bare-2018-mayor", "pending"],
      ["bare-2018-created", "approved"],
    ]);
    expect(bare.revisions[0]!.changes.map((c) => c.field).sort()).toEqual([
      "committee",
      "position",
    ]);

    const mention = result.relations.find((r) => r.id === "mention")!;
    expect(mention).toMatchObject({
      direction: "incoming",
      other: { id: "artykul", name: "PKW" },
      state: "settled",
    });
  });

  it("puts what waits first: proposals, then drafts, then the rest", async () => {
    addEdge("settled", { target: "teryt0261", start_date: "2006-01-01" });
    addEdge("draft", {
      target: "teryt0261",
      start_date: "2024-01-01",
      position: "Rada miasta",
      published: false,
    });
    addEdge("removed", {
      target: "teryt0261",
      start_date: "2002-01-01",
      deleted: true,
      published: false,
    });
    addEdge("proposed", { target: "teryt0261", start_date: "2010-01-01" });
    addRevision("proposal", {
      node_id: "proposed",
      status: "pending",
      update_time: "2026-10-10T12:09:02.000Z",
      data: {
        source: "anna",
        target: "teryt0261",
        type: "election",
        start_date: "2010-01-01",
        position: "Rada miasta",
      },
    });

    const result = await call();

    expect(result.relations.map((r) => [r.id, r.state])).toEqual([
      ["proposed", "proposals"],
      ["draft", "draft"],
      ["settled", "settled"],
      ["removed", "removed"],
    ]);
    expect(result).toMatchObject({
      total: 4,
      drafts: 1,
      withProposals: 1,
      proposals: 1,
      nodePublished: true,
    });
  });

  it("counts only revisions stored as pending as waiting", async () => {
    // Written before review existed: no status, and nothing points at it, so
    // it reads „Oczekuje” - but nobody is waiting on it.
    addEdge("old", { target: "teryt0261", start_date: "2006-01-01" });
    addRevision("legacy", {
      node_id: "old",
      update_time: "2026-03-26T01:45:46.000Z",
      data: {
        source: "anna",
        target: "teryt0261",
        type: "election",
        start_date: "2006-01-01",
      },
    });

    const [relation] = (await call()).relations;

    expect(relation!.revisions[0]!.status).toBe("pending");
    expect(relation!.revisions[0]!.statusDerived).toBe(true);
    expect(relation!.waiting).toBe(0);
    expect(relation!.state).toBe("settled");
  });

  it("says a draft cannot go live while either page is a draft", async () => {
    addEdge("job", {
      target: "firma",
      type: "employed",
      name: "Zarząd",
      published: false,
    });
    addEdge("seat", {
      target: "teryt02",
      start_date: "2023-01-01",
      position: "Sejm",
      published: false,
    });

    let result = await call();
    expect(
      Object.fromEntries(result.relations.map((r) => [r.id, r.publishable])),
    ).toEqual({ job: false, seat: true });

    store["nodes/anna"] = { ...PERSON, published: false };
    result = await call();
    expect(result.nodePublished).toBe(false);
    expect(result.relations.every((r) => !r.publishable)).toBe(true);
  });

  it("reads the revisions thirty relations a query", async () => {
    for (let i = 0; i < 31; i++) {
      addEdge(`edge-${i}`, {
        target: "teryt0261",
        start_date: `${1990 + i}-01-01`,
      });
    }

    await call();

    expect(inQueries.map((chunk) => chunk.length)).toEqual([30, 1]);
  });

  it(`describes at most ${MAX_RELATIONS}, the drafts first, and says how many there are`, async () => {
    for (let i = 0; i < MAX_RELATIONS + 5; i++) {
      addEdge(`edge-${i}`, {
        target: "teryt0261",
        start_date: `2000-01-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }
    addEdge("late-draft", {
      target: "teryt0261",
      start_date: "1990-01-01",
      published: false,
    });

    const result = await call();

    expect(result.relations).toHaveLength(MAX_RELATIONS);
    expect(result.total).toBe(MAX_RELATIONS + 6);
    expect(result.relations.some((r) => r.id === "late-draft")).toBe(true);
  });

  it("answers a page with no relations with an empty list", async () => {
    const result = await call();

    expect(result).toEqual({
      relations: [],
      total: 0,
      drafts: 0,
      withProposals: 0,
      proposals: 0,
      nodePublished: true,
    });
    expect(inQueries).toEqual([]);
  });
});
