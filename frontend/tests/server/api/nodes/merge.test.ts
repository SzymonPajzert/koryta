import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/nodes/merge.post";

const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockCommit = vi.fn();
const mockCacheClear = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};

/** Sequential ids, so a test can tell one written revision from the next. */
let generated = 0;

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
    get: vi.fn(async () => snapshot(collection, id)),
  };
}

function snapshot(collection: string, id: string) {
  return {
    id,
    exists: stored[`${collection}/${id}`] !== undefined,
    data: () => stored[`${collection}/${id}`],
  };
}

/** Every document of one collection matching one equality filter. `stored` is
 * keyed by path, the way the rest of the fake reads it. */
function queryCollection(collection: string, field: string, value: unknown) {
  return Object.entries(stored)
    .filter(([path]) => path.startsWith(`${collection}/`))
    .filter(([, data]) => data?.[field] === value)
    .map(([path, data]) => ({
      id: path.slice(collection.length + 1),
      data: () => data as Record<string, unknown>,
    }));
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) =>
      docRef(collection, id ?? `generated-${++generated}`),
    ),
    where: vi.fn((field: string, _op: string, value: unknown) => ({
      get: vi.fn(async () => {
        const docs = queryCollection(collection, field, value);
        return { docs, size: docs.length, empty: docs.length === 0 };
      }),
    })),
  })),
  getAll: vi.fn(async (...refs: { parent: { id: string }; id: string }[]) =>
    refs.map((ref) => snapshot(ref.parent.id, ref.id)),
  ),
  batch: vi.fn(() => ({
    update: (ref: { path: string }, data: unknown) =>
      mockBatchUpdate(ref.path, data),
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
    commit: mockCommit,
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  // Only reached through `createRevisionTransaction`, which stamps the removal
  // revision; nothing in this path reads the value back.
  Timestamp: { now: () => ({}) },
  FieldValue: { delete: () => "<delete>" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockReadValidatedBody } = vi.hoisted(() => {
  const mockReadValidatedBody = vi.fn();
  globalThis.readValidatedBody = mockReadValidatedBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockReadValidatedBody };
});

function request(body: Record<string, unknown>) {
  mockReadValidatedBody.mockImplementation(
    async (_event: unknown, parse: (b: unknown) => unknown) => {
      try {
        return parse(body);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

function wrote(path: string) {
  return (
    mockBatchUpdate.mock.calls.find((call) => call[0] === path)?.[1] ??
    mockBatchSet.mock.calls.find((call) => call[0] === path)?.[1]
  );
}

function writtenTo(prefix: string) {
  return mockBatchSet.mock.calls.find((call) =>
    String(call[0]).startsWith(prefix),
  )?.[1] as Record<string, unknown> | undefined;
}

/** The two people the merge is about, spelled the way the pipeline spelled
 * them: one register entry, two runs, two names. */
function twoPagesForOneHuman() {
  stored["nodes/dup"] = {
    type: "person",
    name: "Andrzej Golimont",
    rejestrIo: "383093",
    published: true,
  };
  stored["nodes/surv"] = {
    type: "person",
    name: "Andrzej Marcin Golimont",
    rejestrIo: "383093",
    published: true,
  };
}

describe("api/nodes/merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    generated = 0;
    globalThis.useStorage = () => ({ clear: mockCacheClear }) as never;
    request({
      duplicate_id: "dup",
      survivor_id: "surv",
      reason: "Jedna osoba, dwie strony",
    });
    twoPagesForOneHuman();
  });

  it("re-points the duplicate's relations at the page that stays", async () => {
    stored["edges/e-out"] = {
      source: "dup",
      target: "firma",
      type: "employed",
      name: "Prezes",
      start_date: "2020-01-01",
    };
    stored["edges/e-in"] = {
      source: "artykul",
      target: "dup",
      type: "mentions",
    };

    const result = await handler({} as never);

    expect(wrote("edges/e-out")).toEqual({ source: "surv" });
    expect(wrote("edges/e-in")).toEqual({ target: "surv" });
    expect(result.applied).toBe(true);
    expect(result.plan.counts).toMatchObject({ moved: 2 });
  });

  it("puts the duplicate to rest, pointing at the survivor and off the site", async () => {
    const result = await handler({} as never);

    expect(wrote("nodes/dup")).toEqual({
      deleted: true,
      delete_reason: "Jedna osoba, dwie strony",
      merged_into: "surv",
      published: false,
      // Off every list and queue queried on stats at once, not at the next
      // recount - see /api/stats/computeNodes.
      stats: "<delete>",
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(result.plan).toMatchObject({
      duplicate_id: "dup",
      survivor_id: "surv",
      duplicate_name: "Andrzej Golimont",
      survivor_name: "Andrzej Marcin Golimont",
    });
  });

  it("removes a spell the survivor already states, with a revision saying why", async () => {
    stored["edges/e-dup"] = {
      source: "dup",
      target: "firma",
      type: "employed",
      name: "Prezes",
      start_date: "2020-01-01",
    };
    stored["edges/e-surv"] = {
      source: "surv",
      target: "firma",
      type: "employed",
      name: "Prezes",
      start_date: "2020-01-01",
    };

    const result = await handler({} as never);

    expect(result.plan.counts).toMatchObject({ collapsed: 1, moved: 0 });
    expect(wrote("edges/e-dup")).toMatchObject({
      deleted: true,
      delete_reason: expect.stringContaining("e-surv"),
    });
    expect(writtenTo("revisions/")).toMatchObject({
      node_id: "e-dup",
      collection: "edges",
      status: "approved",
      review_user: "admin-uid",
    });
    // And the survivor's own copy is left exactly as it was.
    expect(wrote("edges/e-surv")).toBeUndefined();
  });

  it("keeps a candidacy the survivor appears to state already, and reports it", async () => {
    // `identicalMeansSame: false` for `election`: the office, the gmina TERYT
    // and the run-off round are destroyed before the ingest sees them, so two
    // identical documents are routinely two real candidacies.
    const candidacy = {
      type: "election",
      target: "powiat",
      position: "Samorząd",
      start_date: "2024",
      party: "PiS",
    };
    stored["edges/e-dup"] = { ...candidacy, source: "dup" };
    stored["edges/e-surv"] = { ...candidacy, source: "surv" };

    const result = await handler({} as never);

    expect(result.plan.counts).toMatchObject({ review: 1, collapsed: 0 });
    expect(result.plan.edges).toMatchObject([
      { edge_id: "e-dup", disposition: "review", duplicate_of: "e-surv" },
    ]);
    // Kept, which for the duplicate's copy means moved onto the survivor.
    expect(wrote("edges/e-dup")).toEqual({ source: "surv" });
  });

  it("files the merge naming both pages and the relations it moved", async () => {
    stored["edges/e-out"] = {
      source: "dup",
      target: "firma",
      type: "employed",
    };

    await handler({} as never);

    expect(writtenTo("audit/")).toMatchObject({
      action: "merge",
      collection: "nodes",
      target_id: "dup",
      user: "admin-uid",
      reason: "Jedna osoba, dwie strony",
      merge: { into: "surv", moved: ["e-out"], collapsed: [] },
    });
  });

  it("drops the cached pages, which still list the duplicate", async () => {
    // The entity and graph endpoints are cached per handler for six hours, so
    // both pages would otherwise keep their old relations all day.
    await handler({} as never);

    expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
  });

  it("writes nothing at all for a dry run", async () => {
    // The dialog asks for this first: the count of relations that would be
    // removed is the one thing worth reading before agreeing to a merge.
    stored["edges/e-out"] = {
      source: "dup",
      target: "firma",
      type: "employed",
    };
    request({
      duplicate_id: "dup",
      survivor_id: "surv",
      reason: "Jedna osoba, dwie strony",
      dry_run: true,
    });

    const result = await handler({} as never);

    expect(result.applied).toBe(false);
    expect(result.plan.edges).toMatchObject([{ disposition: "moved" }]);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockCacheClear).not.toHaveBeenCalled();
  });

  it("lands on the page a reader would reach when the survivor was itself merged away", async () => {
    // Otherwise the merge builds a chain nothing follows, and the duplicate's
    // relations end up on a page that is already gone.
    stored["nodes/surv"] = {
      type: "person",
      name: "Andrzej Marcin Golimont",
      merged_into: "final",
    };
    stored["nodes/final"] = { type: "person", name: "Andrzej M. Golimont" };
    stored["edges/e-out"] = {
      source: "dup",
      target: "firma",
      type: "employed",
    };

    const result = await handler({} as never);

    expect(result.plan.survivor_id).toBe("final");
    expect(wrote("edges/e-out")).toEqual({ source: "final" });
    expect(wrote("nodes/dup")).toMatchObject({ merged_into: "final" });
  });

  it("refuses to merge a page with itself", async () => {
    request({ duplicate_id: "dup", survivor_id: "dup", reason: "Powód" });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses an id that names no page", async () => {
    delete stored["nodes/dup"];

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses to fold a person into a company", async () => {
    stored["nodes/surv"] = { type: "company", name: "Szpital sp. z o.o." };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses a duplicate that has already been merged away", async () => {
    stored["nodes/dup"] = {
      type: "person",
      name: "Andrzej Golimont",
      merged_into: "surv",
    };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("is refused to everyone but an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
