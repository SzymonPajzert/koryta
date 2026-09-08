import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/reverseNames.post";

const mockBatchSet = vi.fn();
const mockCommit = vi.fn();
const mockCacheClear = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};

/** Sequential ids, so a test can name the revision the handler wrote. */
let generated = 0;

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) =>
      docRef(collection, id ?? `generated-${++generated}`),
    ),
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
  requireAdmin: vi.fn(async () => ({ uid: "admin-uid", admin: true })),
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
        throw { statusCode: 400, statusMessage: "Bad Request", cause: issue };
      }
    },
  );
}

/** What the batch wrote to an edge document, if anything. */
function edgeWrite(id: string) {
  return mockBatchSet.mock.calls.find((call) => call[0] === `edges/${id}`)?.[1];
}

/** The revision the batch wrote, whatever id it was given. */
function revisionWrites() {
  return mockBatchSet.mock.calls
    .filter((call) => String(call[0]).startsWith("revisions/"))
    .map((call) => call[1] as Record<string, unknown>);
}

describe("api/edges/reverseNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    generated = 0;
    globalThis.useStorage = () => ({ clear: mockCacheClear }) as never;
    stored["edges/e1"] = {
      source: "jan",
      target: "anna",
      type: "connection",
      name: "żona",
      content: "ślub w 2001",
      published: true,
      revision_id: { path: "revisions/old" },
    };
    request({ updates: [{ edge_id: "e1", reverse_name: "mąż" }] });
  });

  it("writes the missing half as an approved revision", async () => {
    const result = await handler({} as never);

    expect(result.updated).toEqual(["e1"]);
    expect(revisionWrites()[0]).toMatchObject({
      collection: "edges",
      node_id: "e1",
      status: "approved",
      update_user: "admin-uid",
      review_user: "admin-uid",
      data: expect.objectContaining({ name: "żona", reverse_name: "mąż" }),
    });
    expect(mockCommit).toHaveBeenCalled();
  });

  it("keeps everything the relation already said", async () => {
    // A revision is a complete snapshot written to the target with `set`, so a
    // field missing from it is a field deleted from the relation.
    await handler({} as never);

    expect(revisionWrites()[0]?.data).toMatchObject({
      source: "jan",
      target: "anna",
      type: "connection",
      content: "ślub w 2001",
    });
  });

  it("leaves a live relation live, and a draft a draft", async () => {
    // Completing what a relation says is not a decision about whether anybody
    // can see it.
    await handler({} as never);
    expect(edgeWrite("e1")).toMatchObject({ published: true });

    vi.clearAllMocks();
    stored["edges/e1"] = { ...stored["edges/e1"]!, published: false };
    await handler({} as never);
    expect(edgeWrite("e1")).toMatchObject({ published: false });
  });

  it("clears the handler cache so the pages stop printing the old word", async () => {
    await handler({} as never);

    expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
  });

  it("writes nothing where the relation already says exactly this", async () => {
    stored["edges/e1"] = { ...stored["edges/e1"]!, reverse_name: "mąż" };

    const result = await handler({} as never);

    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual(["e1"]);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("skips an edge that is not a personal relation", async () => {
    // The word means nothing on an employment, and storing one would put a
    // second job title on the document that nothing reads.
    stored["edges/e1"] = { ...stored["edges/e1"]!, type: "employed" };

    const result = await handler({} as never);

    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([
      { edge_id: "e1", reason: "To nie jest powiązanie osobiste." },
    ]);
  });

  it("skips a relation that is gone, and still writes the rest", async () => {
    // The queue is read a page at a time; somebody else removing a row between
    // the read and the save is ordinary, not worth losing the other writes to.
    stored["edges/e2"] = { ...stored["edges/e1"]!, name: "brat" };
    request({
      updates: [
        { edge_id: "missing", reverse_name: "mąż" },
        { edge_id: "e2", reverse_name: "siostra" },
      ],
    });

    const result = await handler({} as never);

    expect(result.updated).toEqual(["e2"]);
    expect(result.skipped).toEqual([
      { edge_id: "missing", reason: "Nie ma takiego powiązania." },
    ]);
  });

  it("skips a deleted relation", async () => {
    stored["edges/e1"] = { ...stored["edges/e1"]!, deleted: true };

    const result = await handler({} as never);

    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([
      { edge_id: "e1", reason: "Powiązanie usunięte." },
    ]);
  });

  it("refuses a blank reverse", async () => {
    // "Fill in the missing half" with nothing in it is a no-op that would look
    // like progress in the queue.
    request({ updates: [{ edge_id: "e1", reverse_name: "" }] });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuses more than one batch at a time", async () => {
    request({
      updates: Array.from({ length: 101 }, (_, i) => ({
        edge_id: `e${i}`,
        reverse_name: "mąż",
      })),
    });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
