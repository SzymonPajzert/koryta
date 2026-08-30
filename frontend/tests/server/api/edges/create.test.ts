import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/create.post";

/** Every document, keyed by `collection/id`. */
let stored: Record<string, Record<string, unknown> | undefined> = {};
let writes: { path: string; data: Record<string, unknown> }[] = [];

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

let generated = 0;

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) =>
      docRef(collection, id ?? `generated-${++generated}`),
    ),
  })),
  batch: vi.fn(() => ({
    set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data });
      stored[ref.path] = data;
    }),
    commit: vi.fn(async () => {}),
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: class {
    toMillis() {
      return 0;
    }
    static now() {
      return new this();
    }
  },
  FieldValue: { delete: () => "delete" },
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "reader-uid" }),
}));
vi.mock("../../../../server/utils/audit", () => ({ recordAudit: vi.fn() }));

let body: Record<string, unknown> = {};

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.readBody = vi.fn(async () => body);

const edgeWrites = () =>
  writes.filter((write) => write.path.startsWith("edges/"));

describe("POST /api/edges/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generated = 0;
    writes = [];
    stored = {};
    body = {};
  });

  it("writes a relation as a draft", async () => {
    body = {
      source: "person-1",
      target: "place-1",
      type: "employed",
      name: "prezes",
    };
    const result = await handler({} as never);

    expect(result.created).toBe(true);
    expect(edgeWrites()[0]?.data).toMatchObject({
      source: "person-1",
      target: "place-1",
      type: "employed",
      published: false,
    });
  });

  it("lands the same relation stated twice on one document", async () => {
    // Promoting the same extracted fact twice is a button that does this, and
    // the form could always be submitted twice. Two documents saying one thing
    // is what every count and every graph then drew twice.
    body = {
      source: "person-1",
      target: "place-1",
      type: "employed",
      name: "prezes",
      start_date: "2020-01-01",
    };
    const first = await handler({} as never);
    writes = [];
    const second = await handler({} as never);

    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
    expect(edgeWrites()).toHaveLength(0);
  });

  it("does not overwrite a relation that is already live", async () => {
    body = { source: "person-1", target: "place-1", type: "employed" };
    const first = await handler({} as never);
    // An admin has since published it.
    stored[`edges/${first.id}`] = {
      ...stored[`edges/${first.id}`],
      published: true,
    };

    writes = [];
    const second = await handler({} as never);

    expect(second.created).toBe(false);
    expect(stored[`edges/${first.id}`]!.published).toBe(true);
  });

  it("tells two employment spells apart by their start date", async () => {
    body = {
      source: "person-1",
      target: "place-1",
      type: "employed",
      name: "prezes",
      start_date: "2015-01-01",
    };
    const first = await handler({} as never);

    body = { ...body, start_date: "2022-01-01" };
    const second = await handler({} as never);

    expect(second.id).not.toBe(first.id);
    expect(second.created).toBe(true);
  });

  it("refuses a type that is not a declared relation", async () => {
    // It used to accept any truthy string, storing an edge nothing renders and
    // no migration knows about.
    body = { source: "a", target: "b", type: "wspolpracuje" };
    await expect(handler({} as never)).rejects.toThrow();
  });

  it("refuses an election position that is not one", async () => {
    body = {
      source: "person-1",
      target: "region-1",
      type: "election",
      position: "Krolowa",
    };
    await expect(handler({} as never)).rejects.toThrow();
  });

  it("still accepts the blank position the form sends for an empty box", async () => {
    body = {
      source: "person-1",
      target: "place-1",
      type: "employed",
      position: "",
    };
    await expect(handler({} as never)).resolves.toMatchObject({
      created: true,
    });
  });

  it("keeps the cited article on the relation", async () => {
    body = {
      source: "person-1",
      target: "place-1",
      type: "employed",
      references: ["article-1"],
    };
    await handler({} as never);

    expect(edgeWrites()[0]?.data.references).toEqual(["article-1"]);
  });
});
