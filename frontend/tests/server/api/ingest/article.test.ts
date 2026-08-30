import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/ingest/article.post";

/** The firestore double from `articles/mentions.test.ts`: this endpoint writes
 * the same `mentions` edges, through the same helper, and the point of these
 * cases is that it does so in the commit that creates the article. */

/** Every document, keyed by `collection/id`. */
let stored: Record<string, Record<string, unknown> | undefined> = {};
/** Writes the committed batch made, in order. */
let writes: { path: string; data: Record<string, unknown> }[] = [];
let committed = 0;

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
    where: vi.fn(function chain(
      this: unknown,
      field: string,
      _op: string,
      value: unknown,
    ) {
      const filters: [string, unknown][] = [[field, value]];
      const build = () => ({
        where: (nextField: string, _nextOp: string, nextValue: unknown) => {
          filters.push([nextField, nextValue]);
          return build();
        },
        select: () => build(),
        limit: () => build(),
        get: async () => {
          const docs = Object.entries(stored)
            .filter(([path]) => path.startsWith(`${collection}/`))
            .filter(([, data]) => filters.every(([f, v]) => data?.[f] === v))
            .map(([path, data]) => ({
              id: path.slice(collection.length + 1),
              ref: docRef(collection, path.slice(collection.length + 1)),
              data: () => data as Record<string, unknown>,
            }));
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      });
      return build();
    }),
  })),
  getAll: vi.fn(async (...refs: { id: string; path: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: stored[ref.path] !== undefined,
      data: () => stored[ref.path],
    })),
  ),
  batch: vi.fn(() => ({
    set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data });
      stored[ref.path] = data;
    }),
    commit: vi.fn(async () => {
      committed += 1;
    }),
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
    static fromDate(_date: Date) {
      return new this();
    }
  },
  FieldValue: { delete: () => "delete" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "reader-uid" }),
}));

vi.mock("../../../../server/utils/audit", () => ({
  recordAudit: vi.fn(),
}));

let body: Record<string, unknown> = {};

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.readValidatedBody = vi.fn(async (_event: any, parse: any) =>
  parse(body),
);

const mentionWrites = () =>
  writes.filter((write) => write.data.type === "mentions");
const articleWrites = () =>
  writes.filter((write) => write.data.type === "article");

describe("POST /api/ingest/article", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generated = 0;
    writes = [];
    committed = 0;
    body = {};
    stored = {
      "nodes/person-1": { type: "person", name: "Anna Nowak" },
      "nodes/place-1": { type: "place", name: "Spółka" },
      "nodes/region-1": { type: "region", name: "Mazowieckie" },
    };
  });

  it("creates the article and, in the same commit, says it names the person", async () => {
    body = {
      url: "https://example.pl/a",
      name: "Tytuł",
      mentions: ["person-1"],
    };
    const result = await handler({} as never);

    expect(result).toMatchObject({ created: true, mentions: ["person-1"] });
    expect(articleWrites()).toHaveLength(1);
    // One batch, one commit: an article joined to nobody is the state this
    // whole change exists to stop happening.
    expect(committed).toBe(1);
    expect(mentionWrites()[0]?.data).toMatchObject({
      source: result.nodeId,
      target: "person-1",
      type: "mentions",
      published: false,
    });
  });

  it("names an institution as readily as a person", async () => {
    body = { url: "https://example.pl/a", name: "T", mentions: ["place-1"] };
    const result = await handler({} as never);

    expect(result.mentions).toEqual(["place-1"]);
  });

  it("ignores a node kind `mentions` is not declared for", async () => {
    // A note hangs off regions and topics too. Silently skipped rather than
    // rejected: the article is still worth storing.
    body = { url: "https://example.pl/a", name: "T", mentions: ["region-1"] };
    const result = await handler({} as never);

    expect(result.mentions).toEqual([]);
    expect(articleWrites()).toHaveLength(1);
  });

  it("is idempotent - promoting the same note twice adds nothing", async () => {
    body = {
      url: "https://example.pl/a",
      name: "Tytuł",
      mentions: ["person-1"],
    };
    const first = await handler({} as never);

    writes = [];
    const second = await handler({} as never);

    expect(second.nodeId).toBe(first.nodeId);
    expect(second.created).toBe(false);
    expect(second.mentions).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  it("matches an existing article however the url was spelled", async () => {
    body = { url: "https://www.example.pl/a/", name: "T" };
    const first = await handler({} as never);

    body = { url: "example.pl/a", name: "T" };
    const second = await handler({} as never);

    expect(second.nodeId).toBe(first.nodeId);
    expect(second.created).toBe(false);
  });

  it("stores a url pasted without a scheme as an absolute address", async () => {
    // Otherwise the `href` on the article page resolves against koryta.pl, and
    // `/api/revisions/create` refuses to edit the node until it is corrected.
    body = { url: "example.pl/a", name: "T" };
    await handler({} as never);

    expect(articleWrites()[0]?.data.sourceURL).toBe("https://example.pl/a");
  });

  it("refuses something that is not an address at all", async () => {
    body = { url: "nie ma tu adresu", name: "T" };
    await expect(handler({} as never)).rejects.toThrow();
  });
});
