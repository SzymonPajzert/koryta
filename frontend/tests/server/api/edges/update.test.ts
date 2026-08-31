import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/update.post";

const mockBatchSet = vi.fn();
const mockCommit = vi.fn();
const mockCacheClear = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};
let currentUser: { uid: string; admin?: boolean } = { uid: "reader-uid" };

/** Sequential ids, so a test can name the revision the handler wrote. */
let generated = 0;

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
    get: vi.fn(async () => ({
      id,
      exists: stored[`${collection}/${id}`] !== undefined,
      data: () => stored[`${collection}/${id}`],
    })),
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) =>
      docRef(collection, id ?? `generated-${++generated}`),
    ),
  })),
  batch: vi.fn(() => ({
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
    update: vi.fn(),
    commit: mockCommit,
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => ({}) },
  FieldValue: { delete: () => "deleted" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn(async () => currentUser),
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
      } catch (issue) {
        throw {
          statusCode: 400,
          statusMessage: "Bad Request",
          cause: issue,
        };
      }
    },
  );
}

/** What the batch wrote to the edge document, if anything. */
function edgeWrite(id = "e1") {
  return mockBatchSet.mock.calls.find((call) => call[0] === `edges/${id}`)?.[1];
}

/** The revision the batch wrote, whatever id it was given. */
function revisionWrite() {
  return mockBatchSet.mock.calls.find((call) =>
    String(call[0]).startsWith("revisions/"),
  )?.[1] as Record<string, unknown> | undefined;
}

describe("api/edges/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    generated = 0;
    currentUser = { uid: "reader-uid" };
    globalThis.useStorage = () => ({ clear: mockCacheClear }) as never;
    stored["edges/e1"] = {
      source: "jan",
      target: "orlen",
      type: "employed",
      name: "czlonek rady nadzorczej",
      start_date: "2019-01-01",
      published: true,
      revision_id: { path: "revisions/old" },
    };
    request({ edge_id: "e1", name: "prezes zarządu" });
  });

  describe("a contributor", () => {
    it("proposes the change and leaves the relation alone", async () => {
      const result = await handler({} as never);

      expect(result.applied).toBe(false);
      expect(edgeWrite()).toBeUndefined();
      expect(revisionWrite()).toMatchObject({
        collection: "edges",
        node_id: "e1",
        status: "pending",
        update_user: "reader-uid",
        data: expect.objectContaining({ name: "prezes zarządu" }),
      });
      expect(mockCommit).toHaveBeenCalled();
    });

    it("keeps the fields it was not asked about", async () => {
      await handler({} as never);

      // A revision is a complete snapshot written to the target with `set`, so
      // a field missing from it is a field deleted from the relation.
      expect(revisionWrite()?.data).toMatchObject({
        source: "jan",
        target: "orlen",
        type: "employed",
        start_date: "2019-01-01",
      });
    });

    it("does not clear a date the form did not send", async () => {
      request({ edge_id: "e1", name: "prezes zarządu", end_date: "" });
      await handler({} as never);

      const data = revisionWrite()?.data as Record<string, unknown>;
      // An empty string *is* a clear, and an absent key is not - the two have
      // to stay distinguishable or every save would blank the fields the dialog
      // does not draw for that edge type.
      expect(data.start_date).toBe("2019-01-01");
      expect(data.end_date).toBe("");
    });
  });

  describe("an admin", () => {
    beforeEach(() => {
      currentUser = { uid: "admin-uid", admin: true };
    });

    it("applies the change at once", async () => {
      const result = await handler({} as never);

      expect(result.applied).toBe(true);
      expect(edgeWrite()).toMatchObject({ name: "prezes zarządu" });
      expect(revisionWrite()).toMatchObject({ status: "approved" });
      expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
    });

    it("leaves the relation as visible as it found it", async () => {
      stored["edges/e1"] = { ...stored["edges/e1"], published: false };
      await handler({} as never);

      // Correcting a draft must not publish it, and correcting a live relation
      // must not take it off the site.
      expect(edgeWrite()).toMatchObject({ published: false });
    });
  });

  it("refuses to move either end of the relation", async () => {
    currentUser = { uid: "admin-uid", admin: true };
    request({
      edge_id: "e1",
      name: "prezes zarządu",
      source: "anna",
      target: "pkp",
      type: "election",
    });
    await handler({} as never);

    // Not an error - zod strips them - but the relation must still join the two
    // it always did. Moving an end turns a wrong claim into a different claim.
    expect(edgeWrite()).toMatchObject({
      source: "jan",
      target: "orlen",
      type: "employed",
    });
  });

  it("writes nothing when the relation already says this", async () => {
    currentUser = { uid: "admin-uid", admin: true };
    request({ edge_id: "e1", name: "czlonek rady nadzorczej" });

    const result = await handler({} as never);

    expect(result).toMatchObject({ unchanged: true, revision_id: null });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("rejects a date that is not a date", async () => {
    request({ edge_id: "e1", start_date: "styczeń 2019" });
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("404s on a relation that is not there", async () => {
    request({ edge_id: "nope" });
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("refuses a relation that has been removed", async () => {
    stored["edges/e1"] = { ...stored["edges/e1"], deleted: true };
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
