import { describe, it, expect, vi, beforeEach } from "vitest";
// Straight from @google-cloud/firestore, which is where `firebase-admin` gets
// these two from and re-exports them unchanged. The re-export is what cannot be
// used here: `firebase-admin/firestore` is CJS whose named exports are lazy
// getters, and through vitest's interop `(await vi.importActual(…)).FieldPath`
// is listed among the module's keys and reads as `undefined` - the handler then
// dies on „FieldPath is not a constructor” rather than on anything it does.
import { FieldPath } from "@google-cloud/firestore";
import handler from "../../../../server/api/nodes/[id]/badges.post";

const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockCommit = vi.fn();
/** A direct `nodeRef.update`, i.e. a verdict written outside the batch. Held
 * apart from `mockBatchUpdate` because the point of half of these tests is
 * which of the two the handler reaches for. */
const mockDocUpdate = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
    get: vi.fn(async () => ({
      exists: stored[`${collection}/${id}`] !== undefined,
      data: () => stored[`${collection}/${id}`],
    })),
    update: (...args: unknown[]) => mockDocUpdate(`${collection}/${id}`, args),
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => docRef(collection, id ?? "generated-id")),
  })),
  batch: vi.fn(() => ({
    // The field-path overload, so the call is recorded as it was made: the
    // segments matter as much as the value, see the endpoint's own comment on
    // why the key is not a dotted string.
    update: (ref: { path: string }, ...args: unknown[]) =>
      mockBatchUpdate(ref.path, ...args),
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
    commit: mockCommit,
  })),
};

/** The real `FieldPath` and `FieldValue.delete`, not the stubs the other node
 * endpoint tests use: the assertions below are about which segments the write
 * addresses, and a `FieldPath` stubbed to a string would make the test agree
 * with the bug it exists to catch. */
vi.mock("firebase-admin/firestore", async () => {
  const actual = await vi.importActual<
    typeof import("@google-cloud/firestore")
  >("@google-cloud/firestore");
  return {
    FieldPath: actual.FieldPath,
    FieldValue: actual.FieldValue,
    getFirestore: vi.fn(() => mockDb),
  };
});

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockReadValidatedBody, mockCacheClear } = vi.hoisted(() => {
  const mockReadValidatedBody = vi.fn();
  const mockCacheClear = vi.fn();
  globalThis.readValidatedBody = mockReadValidatedBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.useStorage = () => ({ clear: mockCacheClear });
  return { mockReadValidatedBody, mockCacheClear };
});

/** Makes the next request rule on one badge of person-1. */
function request(badgeId: string, verdict: "approved" | "hidden" | null) {
  mockReadValidatedBody.mockImplementation(async (_e, parse) =>
    parse({ badgeId, verdict }),
  );
}

const call = () => handler({} as never);

describe("POST /api/nodes/[id]/badges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.getRouterParam = vi.fn(() => "person-1");
    stored = { "nodes/person-1": { type: "person", name: "Anna Nowak" } };
    request("kot-na-cztery-nogi", "hidden");
  });

  it("writes the verdict under the badge's own key", async () => {
    const result = await call();

    expect(mockBatchUpdate).toHaveBeenCalledWith(
      "nodes/person-1",
      new FieldPath("badgeModeration", "kot-na-cztery-nogi"),
      "hidden",
    );
    expect(result.badgeModeration).toEqual({
      "kot-na-cztery-nogi": "hidden",
    });
  });

  it("files who ruled on which badge, in the same commit as the verdict", async () => {
    // The node keeps the answer and nothing else - `badgeModeration` holds no
    // uid and no time - so without this row nothing says who decided that a
    // public label may stand next to a named living person.
    await call();

    expect(mockBatchSet).toHaveBeenCalledWith(
      "audit/generated-id",
      expect.objectContaining({
        action: "badge",
        collection: "nodes",
        target_id: "person-1",
        user: "admin-uid",
        badge: { id: "kot-na-cztery-nogi", verdict: "hidden" },
      }),
    );
    // One batch and one commit: there is no order of writes in which the
    // verdict lands and the row naming its author does not.
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it("stamps the entry with a time", async () => {
    await call();

    const entry = mockBatchSet.mock.calls[0]?.[1] as { at: string };
    expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
  });

  it("records an approval as its own verdict", async () => {
    request("omnibus", "approved");

    await call();

    expect(mockBatchSet).toHaveBeenCalledWith(
      "audit/generated-id",
      expect.objectContaining({
        badge: { id: "omnibus", verdict: "approved" },
      }),
    );
  });

  it("records a cleared verdict, which the node cannot show afterwards", async () => {
    // Clearing removes the key, so the document ends up identical to one
    // nobody ever ruled on: the row is the only place „redakcja cofnęła
    // decyzję” is written down, and `null` is written rather than left out.
    stored["nodes/person-1"] = {
      type: "person",
      name: "Anna Nowak",
      badgeModeration: { "kot-na-cztery-nogi": "hidden", omnibus: "approved" },
    };
    request("kot-na-cztery-nogi", null);

    const result = await call();

    const entry = mockBatchSet.mock.calls[0]?.[1] as {
      badge: { id: string; verdict: string | null };
    };
    expect(entry.badge).toEqual({ id: "kot-na-cztery-nogi", verdict: null });
    expect("verdict" in entry.badge).toBe(true);
    // The other admin's verdict on the same person survives the clearing.
    expect(result.badgeModeration).toEqual({ omnibus: "approved" });
  });

  it("leaves no row when the page is not a person", async () => {
    stored["nodes/person-1"] = { type: "company", name: "Spółka" };

    await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("leaves no row when the page does not exist", async () => {
    stored = {};

    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses a badge that is not in the catalogue", async () => {
    request("nie-ma-takiej-odznaki", "hidden");

    await expect(call()).rejects.toThrow();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("drops the cached pages that still show the badge", async () => {
    await call();

    expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
  });
});
