import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/revisions/reject.post";

const mockUpdate = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
    update: mockUpdate,
    get: vi.fn(async () => ({
      exists: stored[`${collection}/${id}`] !== undefined,
      data: () => stored[`${collection}/${id}`],
    })),
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => docRef(collection, id)),
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => "now" },
  FieldValue: { delete: () => "DELETED" },
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

describe("api/revisions/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    mockReadValidatedBody.mockImplementation(async (_e, parse) =>
      parse({ revision_id: "rev-1", reason: "brak źródła" }),
    );
  });

  it("marks the revision rejected and keeps the reason", async () => {
    stored["revisions/rev-1"] = { node_id: "node-1", data: { name: "X" } };
    stored["nodes/node-1"] = { name: "Y" };

    const result = await handler({} as never);

    expect(mockUpdate).toHaveBeenCalledWith({
      status: "rejected",
      reject_reason: "brak źródła",
      review_user: "admin-uid",
      review_time: "now",
    });
    expect(result).toMatchObject({ status: "rejected" });
  });

  it("refuses to reject the revision the page is serving", async () => {
    // Otherwise the node keeps showing a snapshot that has been turned down,
    // and nothing else is approved to fall back to.
    stored["revisions/rev-1"] = { node_id: "node-1", data: { name: "X" } };
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/rev-1" },
    };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("allows rejecting a revision that is not the approved one", async () => {
    stored["revisions/rev-1"] = { node_id: "node-1", data: { name: "X" } };
    stored["nodes/node-1"] = {
      name: "Y",
      revision_id: { path: "revisions/rev-other" },
    };

    await handler({} as never);

    expect(mockUpdate).toHaveBeenCalled();
  });

  it("insists on a reason", async () => {
    stored["revisions/rev-1"] = { node_id: "node-1", data: { name: "X" } };
    mockReadValidatedBody.mockImplementation(async (_e, parse) =>
      parse({ revision_id: "rev-1", reason: "   " }),
    );

    await expect(handler({} as never)).rejects.toThrow();
  });

  it("is refused to everyone but an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
