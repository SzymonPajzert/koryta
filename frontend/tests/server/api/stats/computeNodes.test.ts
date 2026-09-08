import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/stats/computeNodes.post";

/** Every collection the handler reads, empty unless a test says otherwise. */
const collections: Record<string, unknown[]> = {
  nodes: [],
  edges: [],
  notes: [],
  votes: [],
  revisions: [],
  extractions: [],
};

const statsDocSet = vi.fn();
const batchUpdate = vi.fn();
const batchCommit = vi.fn();

const mockDb = {
  collection: (name: string) => {
    const query = {
      get: async () => ({ docs: collections[name] ?? [] }),
      // `extractions` is read through a field mask - only the id of the person
      // each fact was matched to - so the query object has to survive a
      // `.select()` on the way to `.get()`.
      select: () => query,
      doc: () => ({ set: statsDocSet }),
    };
    return query;
  },
  batch: () => ({ update: batchUpdate, commit: batchCommit }),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));

// Faked at the token, not at the gate: `requireAdmin` and the `getUser` it
// calls are the thing under test, so both run for real and only the header and
// the token verification are stood in for.
const mockVerifyIdToken = vi.fn();
vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

let authHeader: string | undefined;

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.getRequestHeader = ((_event: unknown, name: string) =>
  name === "Authorization"
    ? authHeader
    : undefined) as typeof globalThis.getRequestHeader;

beforeEach(() => {
  vi.clearAllMocks();
  authHeader = "Bearer token-1";
  mockVerifyIdToken.mockResolvedValue({ uid: "admin-1", admin: true });
  for (const key of Object.keys(collections)) collections[key] = [];
});

describe("POST /api/stats/computeNodes", () => {
  it("refuses a caller who is not an admin", async () => {
    // It rewrites `stats` on every node, which is what every listing is
    // filtered and ordered by, so this is a decision about what the public
    // sees - the same bar as approving a revision.
    mockVerifyIdToken.mockResolvedValue({ uid: "reader-1", admin: false });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("refuses a caller carrying no token", async () => {
    authHeader = undefined;

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("refuses a token that does not verify", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("expired"));

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("reads nothing when it refuses", async () => {
    // A full pass reads every node, edge, note, vote and revision. Refusing
    // after paying for that would leave the bill open to anyone.
    mockVerifyIdToken.mockResolvedValue({ uid: "reader-1", admin: false });
    const nodes = vi.fn();
    collections.nodes = [{ id: "n-1", data: nodes }];

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(nodes).not.toHaveBeenCalled();
    expect(batchCommit).not.toHaveBeenCalled();
  });

  it("lets an admin through", async () => {
    const result = await handler({} as never);

    expect(result).toMatchObject({ status: "success" });
    expect(statsDocSet).toHaveBeenCalled();
  });

  /** `stats` is written as one map, so a pass that did not count the facts
   * would take `stats.factsCount` off every person - and /eksploruj/tabela's
   * „Liczba faktów” sort drops a person who lacks the field rather than
   * sorting them last, so the whole table would empty out behind it. */
  it("recounts the extracted facts onto each person", async () => {
    collections.nodes = [
      { id: "person-1", data: () => ({ type: "person", name: "A" }) },
      { id: "person-2", data: () => ({ type: "person", name: "B" }) },
    ];
    collections.extractions = [
      { get: (field: string) => (field === "personNodeId" ? "person-1" : "") },
      { get: (field: string) => (field === "personNodeId" ? "person-1" : "") },
      { get: () => undefined },
    ];

    await handler({} as never);

    const written = Object.fromEntries(
      batchUpdate.mock.calls.map(([, data], index) => [
        collections.nodes[index]!.id,
        data.stats.factsCount,
      ]),
    );
    expect(written).toEqual({ "person-1": 2, "person-2": 0 });
  });
});
