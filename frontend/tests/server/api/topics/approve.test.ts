import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/topics/[id]/approve.post";

const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockCommit = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};

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
    doc: vi.fn((id?: string) => docRef(collection, id ?? "generated-id")),
    where: vi.fn((field: string, op: string, value: unknown) => ({
      get: vi.fn(async () => {
        const docs = Object.entries(stored)
          .filter(([path]) => path.startsWith(`${collection}/`))
          .filter(([, data]) =>
            op === "in"
              ? (value as unknown[]).includes(data?.[field])
              : data?.[field] === value,
          )
          .map(([path, data]) => ({
            id: path.slice(collection.length + 1),
            data: () => data as Record<string, unknown>,
          }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      }),
    })),
  })),
  getAll: vi.fn(async (...refs: { id: string; path: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      ref,
      exists: stored[ref.path] !== undefined,
      data: () => stored[ref.path],
    })),
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
  // `revisionTime` narrows `update_time` with `instanceof Timestamp`, so the
  // mocked module still has to export something constructible.
  Timestamp: class {
    toMillis() {
      return 0;
    }
    static now() {
      return new this();
    }
  },
  FieldValue: { delete: () => "deleted" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockReadValidatedBody } = vi.hoisted(() => {
  const mockReadValidatedBody = vi.fn();
  globalThis.readValidatedBody = mockReadValidatedBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).getRouterParam = () => "topic-1";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockReadValidatedBody };
});

function request(body: Record<string, unknown>) {
  mockReadValidatedBody.mockImplementation(
    async (_event: unknown, parse: (b: unknown) => unknown) => parse(body),
  );
}

/** A tag between an article and the topic, as written when it was proposed. */
const tag = { source: "article-1", target: "topic-1", type: "tagged" };

/** What the batch wrote to the tag's document. */
function tagUpdate() {
  return mockBatchUpdate.mock.calls.find((call) => call[0] === "edges/t1")?.[1];
}

describe("api/topics/[id]/approve, the tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {
      // Already approved and live, so only the tags are this call's business.
      "nodes/topic-1": {
        type: "topic",
        name: "Afera",
        published: true,
        revision_id: "revisions/topic-approved",
      },
      "edges/t1": { ...tag, published: false },
      "revisions/written": {
        node_id: "t1",
        collection: "edges",
        status: "pending",
        update_time: "2026-06-01T00:00:00.000Z",
        data: tag,
      },
    };
    request({ edgeIds: ["t1"] });
  });

  it("puts a tag up as the revision it holds", async () => {
    const result = await handler({} as never);

    expect(result).toMatchObject({ published: true, tags: 1 });
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      "revisions/written",
      expect.objectContaining({ status: "approved", review_user: "admin-uid" }),
    );
    expect(tagUpdate()).toEqual({
      published: true,
      revision_id: expect.objectContaining({ id: "written" }),
    });
  });

  it("leaves a newer proposal to change the tag pending", async () => {
    // Publishing the tag approves what it says, not a change somebody has
    // only proposed: that would mark the proposal approved with nothing of it
    // on the tag.
    stored["revisions/proposal_t1_x"] = {
      node_id: "t1",
      collection: "edges",
      status: "pending",
      update_time: "2026-09-01T00:00:00.000Z",
      data: { ...tag, content: "Wspomniany w kontekście przetargu" },
    };

    await handler({} as never);

    expect(tagUpdate()).toEqual({
      published: true,
      revision_id: expect.objectContaining({ id: "written" }),
    });
    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      "revisions/proposal_t1_x",
      expect.anything(),
    );
  });

  it("puts a tag up on its own document when it holds none of its revisions", async () => {
    stored["revisions/written"]!.data = { ...tag, content: "inny opis" };

    await handler({} as never);

    expect(tagUpdate()).toEqual({ published: true });
    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      "revisions/written",
      expect.anything(),
    );
  });
});
