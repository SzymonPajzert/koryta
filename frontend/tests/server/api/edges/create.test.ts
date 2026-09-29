import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/create.post";

/** Every document, keyed by `collection/id`. */
let stored: Record<string, Record<string, unknown> | undefined> = {};
let writes: { path: string; data: Record<string, unknown> }[] = [];
/** Partial updates, which is how a fact is told what it became. */
let updates: { path: string; data: Record<string, unknown> }[] = [];

function docRef(collection: string, id: string) {
  const path = `${collection}/${id}`;
  return {
    id,
    path,
    parent: { id: collection },
    get: vi.fn(async () => ({
      id,
      exists: stored[path] !== undefined,
      data: () => stored[path],
    })),
    update: vi.fn(async (data: Record<string, unknown>) => {
      updates.push({ path, data });
    }),
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
    update: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      updates.push({ path: ref.path, data });
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
  FieldValue: {
    delete: () => "delete",
    arrayUnion: (...values: unknown[]) => ({ arrayUnion: values }),
  },
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
    updates = [];
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

  it("records a win on a candidacy and nowhere else", async () => {
    body = {
      source: "person-1",
      target: "region-1",
      type: "election",
      elected: true,
    };
    await handler({} as never);
    expect(edgeWrites()[0]?.data.elected).toBe(true);

    // The dialog keeps its fields across a change of mind, so a box ticked on
    // a region can still be riding along once the reader has picked a company.
    writes = [];
    body = {
      source: "person-1",
      target: "place-1",
      type: "employed",
      elected: true,
    };
    await handler({} as never);
    expect(edgeWrites()[0]?.data).not.toHaveProperty("elected");
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

  describe("made from an extracted fact", () => {
    // „Utwórz powiązanie” names the fact it was clicked on, so every card that
    // draws the fact can say it is already in the graph rather than offer it
    // to the next reader, who picks the far end afresh.
    const promotion = {
      source: "person-1",
      target: "place-1",
      type: "employed",
      name: "prezes",
      extraction: "fact-1",
    };

    beforeEach(() => {
      // An employment matched to person-1, and the company it is promoted to.
      stored["extractions/fact-1"] = {
        fact_type: "employment",
        personNodeId: "person-1",
      };
      stored["nodes/place-1"] = { type: "place", name: "Spółka Wodna" };
    });

    it("tells the fact which relation it became", async () => {
      body = promotion;
      const result = await handler({} as never);

      expect(result.created).toBe(true);
      expect(updates).toEqual([
        {
          path: "extractions/fact-1",
          data: { promotedEdgeIds: { arrayUnion: [result.id] } },
        },
      ]);
    });

    it("tells it too when the relation was already there", async () => {
      // Somebody's „Dodaj” on the person's page, or an earlier promotion:
      // nothing new is written, but the fact does stand for that relation.
      body = promotion;
      const first = await handler({} as never);
      writes = [];
      updates = [];

      const second = await handler({} as never);

      expect(second).toEqual({ id: first.id, created: false });
      expect(edgeWrites()).toHaveLength(0);
      expect(updates).toEqual([
        {
          path: "extractions/fact-1",
          data: { promotedEdgeIds: { arrayUnion: [first.id] } },
        },
      ]);
    });

    it("leaves the fact alone when that relation was removed, and says so", async () => {
      // An administrator took it off the graph. Marking the fact would have
      // its card point at a relation that is not there, and writing it again
      // would undo the removal with nobody reviewing it.
      body = promotion;
      const first = await handler({} as never);
      stored[`edges/${first.id}`] = {
        ...stored[`edges/${first.id}`],
        deleted: true,
      };
      writes = [];
      updates = [];

      const second = await handler({} as never);

      expect(second).toEqual({ id: first.id, created: false, deleted: true });
      expect(edgeWrites()).toHaveLength(0);
      expect(updates).toHaveLength(0);
    });

    it("refuses a fact about somebody else, and writes nothing", async () => {
      stored["extractions/fact-1"] = {
        fact_type: "employment",
        personNodeId: "person-2",
      };
      body = promotion;

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(edgeWrites()).toHaveLength(0);
      expect(updates).toHaveLength(0);
    });

    it("refuses a relation of another kind than the fact becomes", async () => {
      // An employment becomes `employed`; a `connection` to whatever id a
      // request names would mark it by a relation it could never have been.
      body = { ...promotion, type: "connection", target: "person-9" };
      stored["nodes/person-9"] = { type: "person" };

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(edgeWrites()).toHaveLength(0);
      expect(updates).toHaveLength(0);
    });

    it("refuses a fact of a kind that becomes no relation", async () => {
      stored["extractions/fact-1"] = {
        fact_type: "party_membership",
        personNodeId: "person-1",
      };
      body = promotion;

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(updates).toHaveLength(0);
    });

    it("refuses a far end that is not in the graph, or not of the kind asked for", async () => {
      body = { ...promotion, target: "does-not-exist" };
      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });

      stored["nodes/person-9"] = { type: "person" };
      body = { ...promotion, target: "person-9" };
      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });

      expect(edgeWrites()).toHaveLength(0);
      expect(updates).toHaveLength(0);
    });

    it("refuses a fact that is not there", async () => {
      delete stored["extractions/fact-1"];
      body = promotion;

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(edgeWrites()).toHaveLength(0);
    });

    it("touches no fact when none is named", async () => {
      body = { ...promotion, extraction: undefined };
      await handler({} as never);

      expect(updates).toHaveLength(0);
    });
  });
});
