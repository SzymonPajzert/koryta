import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRevisionTransaction } from "../../../../server/utils/revisions";
import handler from "../../../../server/api/ingest/aid.post";

/** A Firestore double that answers by collection.
 *
 * The aid ingest reads two collections in two different ways - a query on
 * `nodes` to find a place by its register number, and a point read on `edges`
 * to see what an edge already says - so a single flat mock of the kind
 * `company.test.ts` uses cannot express what this handler does.
 */
const nodesByKrs = new Map<string, Record<string, unknown>>();
const nodesByNip = new Map<string, Record<string, unknown>>();
const nodesById = new Map<string, Record<string, unknown>>();
const storedEdges = new Map<string, Record<string, unknown>>();
const writtenEdgeIds: string[] = [];

const mockCommit = vi.fn();
const mockDb = {
  batch: () => ({ commit: mockCommit, set: vi.fn() }),
  collection: (name: string) => {
    if (name === "edges") {
      return {
        doc: (id: string) => {
          writtenEdgeIds.push(id);
          return {
            id,
            get: async () => ({
              exists: storedEdges.has(id),
              data: () => storedEdges.get(id),
            }),
          };
        },
      };
    }
    // nodes
    let field = "";
    let value = "";
    const query = {
      where: (whereField: string, _op: string, whereValue: string) => {
        field = whereField;
        value = whereValue;
        return query;
      },
      limit: () => query,
      get: async () => {
        const source = field === "krsNumber" ? nodesByKrs : nodesByNip;
        const stored = source.get(value);
        if (!stored) return { empty: true, docs: [] };
        return {
          empty: false,
          docs: [
            {
              id: `node-${value}`,
              ref: { id: `node-${value}` },
              data: () => stored,
            },
          ],
        };
      },
    };
    return {
      ...query,
      doc: (id?: string) =>
        id
          ? {
              id,
              get: async () => ({
                exists: nodesById.has(id),
                data: () => nodesById.get(id),
              }),
            }
          : { id: "new-node-id" },
    };
  },
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "test-user-id" }),
}));
vi.mock("../../../../server/utils/revisions", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/revisions")
  >()),
  createRevisionTransaction: vi.fn(),
}));

const { mockReadBody } = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.createError = (err: any) => err;
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.readValidatedBody = async (event: any, parse: any) => {
    const body = await mockReadBody();
    try {
      return parse(body);
    } catch {
      throw { statusCode: 400, message: "Invalid aid payload" };
    }
  };
  return { mockReadBody };
});

const payload = {
  measure: "SA.116730",
  krs: "0000345467",
  nip: "7531608850",
  name: "ALL WINDOWS GROUP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  teryt: "1607053",
  activity: ["22.23"],
  grants: [
    {
      grantor_nip: "7532132088",
      grantor_name: "STAROSTA POWIATU NYSA",
      gross: 16962251,
      decisions: 2,
      first_decision: "2024-11-20",
      last_decision: "2025-03-06",
    },
  ],
};

describe("api/ingest/aid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodesByKrs.clear();
    nodesByNip.clear();
    nodesById.clear();
    storedEdges.clear();
    writtenEdgeIds.length = 0;
  });

  it("stores a beneficiary with no KRS number, unpublished", async () => {
    // 2967 of the 3715 beneficiaries are sole traders. They are all kept - a
    // filter that dropped them dropped the single-decision micro-firms worth
    // reading - and none of them is published by the ingest that stored it.
    const { krs, ...withoutKrs } = payload;
    mockReadBody.mockResolvedValue(withoutKrs);

    const result = await handler({} as any);

    expect(result).toMatchObject({ code: 200 });
    const placeCall = vi.mocked(createRevisionTransaction).mock.calls[0];
    expect(placeCall?.[4]).toMatchObject({ type: "place", nipNumber: "7531608850" });
    expect(placeCall?.[4]).not.toHaveProperty("krsNumber");
    expect(placeCall?.[5]).toMatchObject({ published: false, approve: false });
  });

  it("rejects a beneficiary with no NIP, which is the only key it always has", async () => {
    const { nip, krs, ...withoutIdentifiers } = payload;
    mockReadBody.mockResolvedValue(withoutIdentifiers);

    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("publishes a company that arrives with a KRS number", async () => {
    mockReadBody.mockResolvedValue(payload);

    await handler({} as any);

    const placeCall = vi.mocked(createRevisionTransaction).mock.calls[0];
    expect(placeCall?.[5]).toMatchObject({ published: true });
  });

  it("takes soleTrader over the guess it would otherwise make", async () => {
    // A spółka jawna is in KRS and is still natural persons trading; the
    // pipeline knows which register answered, so it gets to say.
    mockReadBody.mockResolvedValue({ ...payload, soleTrader: true });

    await handler({} as any);

    expect(vi.mocked(createRevisionTransaction).mock.calls[0]?.[5]).toMatchObject({
      published: false,
    });
  });

  describe("a sole trader tied to somebody on the site", () => {
    const soleTrader = {
      ...payload,
      krs: undefined,
      name: 'P.P.H.U. "TRAK" Jan Krupa',
      teryt: "0207011",
      owner: { name: "Jan Krupa", node_id: "person-1", teryt: "0207" },
    };

    it("drops the claim, not the aid, when the person is in a different powiat", async () => {
      // What every one of the 21 name matches in the real data looks like. The
      // grant is still public money and still gets stored; only the guess about
      // who owns the recipient is discarded.
      nodesById.set("person-1", {
        type: "person",
        name: "Jan Krupa",
        stats: { edges: { all: { targetNodeIds: { "0": "teryt2819" } } } },
      });
      mockReadBody.mockResolvedValue(soleTrader);

      const result = await handler({} as any);

      expect(result).toMatchObject({ code: 200 });
      const ownsToPerson = vi
        .mocked(createRevisionTransaction)
        .mock.calls.find(
          (call) => (call[4] as Record<string, unknown>).source === "person-1",
        );
      expect(ownsToPerson).toBeUndefined();
      // ...and the aid edge is there regardless.
      expect(
        vi
          .mocked(createRevisionTransaction)
          .mock.calls.some(
            (call) => (call[4] as Record<string, unknown>).type === "aid",
          ),
      ).toBe(true);
    });

    it("drops the claim when the named node is not the person it was matched by", async () => {
      nodesById.set("person-1", {
        type: "person",
        name: "Jan Kowalski",
        stats: { edges: { all: { targetNodeIds: { "0": "teryt0207" } } } },
      });
      mockReadBody.mockResolvedValue(soleTrader);

      await handler({} as any);

      expect(
        vi
          .mocked(createRevisionTransaction)
          .mock.calls.find(
            (call) => (call[4] as Record<string, unknown>).source === "person-1",
          ),
      ).toBeUndefined();
    });

    it("links the person, unpublished, when the powiat agrees", async () => {
      nodesById.set("person-1", {
        type: "person",
        name: "Jan Krupa",
        // Stored as an object keyed by index, which is how koryta.pl's arrays
        // come back out of Firestore.
        stats: {
          edges: { all: { targetNodeIds: { "0": "teryt0207", "1": "teryt10" } } },
        },
      });
      mockReadBody.mockResolvedValue(soleTrader);

      await handler({} as any);

      const ownsCall = vi
        .mocked(createRevisionTransaction)
        .mock.calls.find(
          (call) =>
            (call[4] as Record<string, unknown>).type === "owns" &&
            (call[4] as Record<string, unknown>).source === "person-1",
        );
      expect(ownsCall?.[4]).toMatchObject({
        source: "person-1",
        target: expect.any(String),
        type: "owns",
      });
      // The claim a reviewer is being asked about, so it is never published by
      // the pipeline that made it.
      expect(ownsCall?.[5]).toMatchObject({ published: false, approve: false });

      // Nor is the business itself, unlike a company arriving with a KRS number.
      const placeCall = vi.mocked(createRevisionTransaction).mock.calls[0];
      expect(placeCall?.[4]).toMatchObject({
        type: "place",
        nipNumber: "7531608850",
      });
      expect(placeCall?.[4]).not.toHaveProperty("krsNumber");
      expect(placeCall?.[5]).toMatchObject({ published: false });
    });
  });

  it("rejects a mistyped NIP rather than storing it", async () => {
    mockReadBody.mockResolvedValue({ ...payload, nip: "1234567890" });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("writes the beneficiary with the NIP that found it", async () => {
    mockReadBody.mockResolvedValue(payload);

    const result = await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      expect.anything(),
      expect.objectContaining({
        name: payload.name,
        type: "place",
        krsNumber: "0000345467",
        // No stored company carries one today, so this write is what makes the
        // next SUDOP run able to find it without the biała lista.
        nipNumber: "7531608850",
        activity: ["22.23"],
      }),
      expect.objectContaining({ automatic: true, published: true }),
    );
    expect(result).toMatchObject({ code: 200, edges: expect.any(Array) });
  });

  it("creates a granting institution unpublished, flagged public sector", async () => {
    mockReadBody.mockResolvedValue(payload);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalledWith(
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      expect.anything(),
      expect.objectContaining({
        name: "STAROSTA POWIATU NYSA",
        type: "place",
        nipNumber: "7532132088",
        isPublic: true,
      }),
      expect.objectContaining({ published: false, approve: false }),
    );
  });

  it("does not overwrite a human's answer about the grantor's ownership", async () => {
    nodesByNip.set("7532132088", {
      name: "Starostwo Powiatowe w Nysie",
      published: true,
      isPublic: false,
      isPublicSource: "manual",
    });
    mockReadBody.mockResolvedValue(payload);

    await handler({} as any);

    const grantorCall = vi
      .mocked(createRevisionTransaction)
      .mock.calls.find(
        (call) =>
          (call[4] as Record<string, unknown>).nipNumber === "7532132088",
      );
    expect(grantorCall?.[4]).not.toHaveProperty("isPublic", true);
  });

  it("leaves an unchanged granting institution alone", async () => {
    // 25 institutions stand behind 1040 grants. Restating one per grant would
    // write 1040 revisions saying nothing, and put every one of them in front
    // of a reviewer.
    nodesByNip.set("7532132088", {
      name: "STAROSTA POWIATU NYSA",
      type: "place",
      nipNumber: "7532132088",
      isPublic: true,
      published: true,
    });
    mockReadBody.mockResolvedValue(payload);

    await handler({} as any);

    const grantorCalls = vi
      .mocked(createRevisionTransaction)
      .mock.calls.filter(
        (call) =>
          (call[4] as Record<string, unknown>).nipNumber === "7532132088",
      );
    expect(grantorCalls).toHaveLength(0);
  });

  it("puts the totals on the edge, keyed so a re-run replaces them", async () => {
    mockReadBody.mockResolvedValue(payload);

    await handler({} as any);

    const edgeCall = vi
      .mocked(createRevisionTransaction)
      .mock.calls.find(
        (call) => (call[4] as Record<string, unknown>).type === "aid",
      );
    expect(edgeCall?.[4]).toMatchObject({
      type: "aid",
      aidMeasure: "SA.116730",
      aidGross: 16962251,
      aidDecisions: 2,
      start_date: "2024-11-20",
      end_date: "2025-03-06",
    });

    // Two decisions, one edge - and the same id whatever the totals say, so a
    // later run lands on this document rather than beside it.
    const aidIds = writtenEdgeIds.filter((id) => id.includes("_aid"));
    expect(aidIds).toHaveLength(1);

    storedEdges.set(aidIds[0]!, { published: true });
    writtenEdgeIds.length = 0;
    mockReadBody.mockResolvedValue({
      ...payload,
      grants: [{ ...payload.grants[0]!, gross: 20000000, decisions: 3 }],
    });
    await handler({} as any);

    expect(writtenEdgeIds.filter((id) => id.includes("_aid"))).toEqual(aidIds);
  });

  it("keeps an edge a reviewer has not approved out of sight", async () => {
    mockReadBody.mockResolvedValue(payload);
    await handler({} as any);
    const aidId = writtenEdgeIds.find((id) => id.includes("_aid"))!;

    // Stored and not published: somebody has looked at this link and has not
    // approved it. Restating the totals must not publish it.
    storedEdges.set(aidId, { published: false });
    vi.mocked(createRevisionTransaction).mockClear();

    await handler({} as any);

    const edgeCall = vi
      .mocked(createRevisionTransaction)
      .mock.calls.find(
        (call) => (call[4] as Record<string, unknown>).type === "aid",
      );
    expect(edgeCall?.[5]).toMatchObject({ published: false, approve: false });
  });
});
