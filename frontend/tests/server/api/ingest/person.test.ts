import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createRevisionTransaction,
  proposeRevisionTransaction,
} from "../../../../server/utils/revisions";
import { edgeDocumentId, type EdgeLike } from "../../../../server/utils/edges";
import handler from "../../../../server/api/ingest/person.post";

// Mock dependencies
const mockGet = vi.fn();
const mockLimit = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockBatch = vi.fn();
const mockCommit = vi.fn();
const mockRef = { id: "doc-ref-id" };

const mockDb = {
  collection: mockCollection,
  batch: mockBatch,
};

mockCollection.mockReturnValue({
  where: mockWhere,
  doc: mockDoc,
});
// Need to handle chaining: .where().where().limit().get()
const queryMock = {
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: mockGet,
};
mockWhere.mockImplementation(() => queryMock);
mockLimit.mockImplementation(() => queryMock);

mockDoc.mockReturnValue({
  id: "new-doc-id",
  ref: mockRef,
});
mockBatch.mockReturnValue({
  commit: mockCommit,
  set: vi.fn(),
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));

vi.mock("firebase-admin/app", () => ({
  getApp: vi.fn(),
}));

// Only `getUser` is faked. `requireDatascience` is a pure check on the decoded
// token, so the endpoint's real gate runs against whatever `getUser` hands back.
const mockGetUser = vi.fn();
vi.mock("../../../../server/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/utils/auth")>()),
  getUser: (...args: unknown[]) => mockGetUser(...args),
}));

vi.mock("../../../../server/utils/revisions", async (importOriginal) => {
  // `withoutInternalFields` is pure and is what decides which of the stored
  // edge's fields a proposal carries, so the tests below want the real one.
  const actual =
    await importOriginal<typeof import("../../../../server/utils/revisions")>();
  return {
    ...actual,
    createRevisionTransaction: vi.fn(() => ({
      revisionRef: { id: "mock-revision-id", path: "mock/path" },
      targetRef: { id: "mock-target-id", path: "mock/target/path" },
    })),
    proposeRevisionTransaction: vi.fn(() => ({
      revisionRef: { id: "mock-revision-id", path: "mock/path" },
      targetRef: { id: "mock-target-id", path: "mock/target/path" },
    })),
  };
});

const { mockReadBody } = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.readBody = mockReadBody;
  globalThis.createError = (err: any) => err;
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.useStorage = vi.fn(() => ({ clear: vi.fn() }));
  globalThis.readValidatedBody = async (event: any, parse: any) => {
    const body = await mockReadBody();
    try {
      return parse(body);
    } catch {
      throw { statusCode: 400, message: "Missing required fields" };
    }
  };
  return { mockReadBody };
});

describe("api/ingest/person", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ uid: "test-user-id", datascience: true });
    // Reset query chain mocks
    mockWhere.mockReturnValue(queryMock);
    queryMock.where.mockReturnValue(queryMock);
    queryMock.limit.mockReturnValue(queryMock);
  });

  it("refuses a caller who is not in the datascience group", async () => {
    // Being logged in is not enough: this endpoint takes the caller's word for
    // whether a change is approved, including changes to candidacies it did not
    // create.
    mockGetUser.mockResolvedValue({ uid: "test-user-id" });
    mockReadBody.mockResolvedValue({
      name: "Test Person",
      parties: [],
      companies: [],
    });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("should throw 400 if name is missing", async () => {
    mockReadBody.mockResolvedValue({});
    try {
      await handler({} as any);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e).toEqual({
        statusCode: 400,
        message: "Missing required fields",
      });
    }
  });

  it("should create edges to regions if elections are provided", async () => {
    mockReadBody.mockResolvedValue({
      name: "Test Person",
      parties: [],
      companies: [],
      elections: [
        {
          party: "Test Party",
          election_year: "2023",
          election_type: "Sejmik",
          teryt: "02",
        },
      ],
    });

    // Person query: Empty (creating new person)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "person-id", ref: mockRef });

    // Region 1 (02) query: Found
    const regionRef1 = { id: "region-id-02" };
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ ref: regionRef1, id: "region-id-02" }],
    });

    // Edge 1 creation
    const edgeRef1 = { id: "edge-id-1" };
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] }); // Edge doesn't exist yet
    mockDoc.mockReturnValueOnce(edgeRef1);

    // Region 2 (0201) query: Not found, mock create
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const newRegionRef = { id: "region-id-0201" };
    mockDoc.mockReturnValueOnce(newRegionRef);

    // Edge 2 creation
    const edgeRef2 = { id: "edge-id-2" };
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] }); // Edge doesn't exist yet
    mockDoc.mockReturnValueOnce(edgeRef2);

    const result = await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalled();

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      expect.objectContaining({ uid: "test-user-id" }),
      edgeRef1,
      {
        source: "person-id",
        target: "region-id-02",
        type: "election",
        name: "kandydatura",
        position: "Sejmik",
        party: "Test Party",
        start_date: "2023-01-01",
      },
      { automatic: true, approve: false, published: false },
    );
    expect(result.elections).toHaveLength(1);
  });

  it("stores the electoral committee a candidacy was run under", async () => {
    // The pipeline has always sent `committee`; the schema used to strip it, so
    // no stored candidacy has one - which is most of why two candidacies in one
    // town in one year cannot be told apart.
    mockReadBody.mockResolvedValue({
      name: "Test Person",
      parties: [],
      companies: [],
      elections: [
        {
          committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
          election_year: "2024",
          election_type: "Samorząd",
          teryt: "1465",
        },
      ],
    });

    // The test above queues more `...Once` results than it consumes, and
    // clearAllMocks does not drain that queue.
    mockGet.mockReset();
    mockDoc.mockReset();
    mockDoc.mockReturnValue({ id: "new-doc-id", ref: mockRef });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "person-id", ref: mockRef });
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ ref: { id: "teryt1465" }, id: "teryt1465" }],
    });
    const edgeRef = { id: "edge-id" };
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce(edgeRef);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      expect.objectContaining({ uid: "test-user-id" }),
      edgeRef,
      expect.objectContaining({
        type: "election",
        committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
      }),
      { automatic: true, approve: false, published: false },
    );
  });

  describe("a candidacy the database already has", () => {
    /** The shape every one of the 10476 stored candidacies has today: written
     * before the ingest accepted a committee, so carrying none. */
    const storedCandidacy = {
      source: "person-id",
      target: "teryt1465",
      type: "election",
      name: "kandydatura",
      position: "Samorząd",
      start_date: "2024-01-01",
    };

    /** Queue the three lookups one election payload makes: the person, the
     * region, and the edges already between them. */
    function personWithStoredEdges(
      stored: Record<string, unknown>[],
      ids: string[] = stored.map((_, i) => `stored-${i}`),
    ) {
      mockGet.mockReset();
      mockDoc.mockReset();
      mockDoc.mockImplementation((id?: string) => ({
        id: id ?? "new-doc-id",
        ref: mockRef,
      }));
      mockGet.mockResolvedValueOnce({
        empty: false,
        // These tests are about the candidacy rather than the person, so the
        // node carries nothing - `data()` still has to be there, because the
        // person branch reads the visibility off the document it looked up.
        docs: [{ id: "person-id", ref: mockRef, data: () => ({}) }],
      });
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: { id: "teryt1465" }, id: "teryt1465" }],
      });
      mockGet.mockResolvedValueOnce({
        empty: stored.length === 0,
        docs: stored.map((edge, index) => ({
          id: ids[index],
          data: () => edge,
        })),
      });
    }

    function payload(election: Record<string, unknown>) {
      return {
        name: "Test Person",
        parties: [],
        companies: [],
        elections: [{ election_type: "Samorząd", teryt: "1465", ...election }],
      };
    }

    it("writes onto the stored candidacy, not beside it", async () => {
      // The whole point: `committee` is part of edgeIdentity, so without this
      // the restated candidacy hashes to a new document id and 10476 edges
      // become 20952.
      personWithStoredEdges([storedCandidacy]);
      mockReadBody.mockResolvedValue(
        payload({
          election_year: "2024",
          committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
          party: "PiS",
          party_from_committee: true,
        }),
      );

      await handler({} as any);

      expect(proposeRevisionTransaction).not.toHaveBeenCalled();
      // The committee map vouched for this one, so it is written out rather
      // than proposed - through the same path any approved revision takes.
      expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
      const call = vi.mocked(createRevisionTransaction).mock.calls[0]!;
      expect(call[3]).toEqual({ id: "stored-0", ref: mockRef });
      expect(call[4]).toEqual({
        ...storedCandidacy,
        committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
        party: "PiS",
      });
      expect(call[5]).toMatchObject({ approve: true });
    });

    it("leaves an unrecognised committee for a reviewer", async () => {
      // A one-gmina KWW is usually harmless, but it is also where a misspelt
      // national committee hides, and nothing has vouched for this one.
      personWithStoredEdges([storedCandidacy]);
      mockReadBody.mockResolvedValue(
        payload({
          election_year: "2024",
          committee: "Komitet Wyborczy Wyborców Wspólny Kalisz",
        }),
      );

      await handler({} as any);

      expect(createRevisionTransaction).not.toHaveBeenCalled();
      expect(proposeRevisionTransaction).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(proposeRevisionTransaction).mock.calls[0]![5],
      ).toMatchObject({ automatic: true });
    });

    it("keeps a candidacy off the public site if that is where it was", async () => {
      // 9123 of the 10476 have no revision_id. Learning their committee is not
      // a decision to publish them.
      personWithStoredEdges([storedCandidacy]);
      mockReadBody.mockResolvedValue(
        payload({
          election_year: "2024",
          committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
          party_from_committee: true,
        }),
      );

      await handler({} as any);

      // The stored edge is handed over whole, which is what carries its
      // visibility - and its votes, and anything else it owns - through the
      // `set` that writes the revision.
      expect(vi.mocked(createRevisionTransaction).mock.calls[0]![5]).toEqual({
        automatic: true,
        approve: true,
        stored: expect.objectContaining({ type: "election" }),
      });
    });

    it("keeps a published candidacy published", async () => {
      personWithStoredEdges([{ ...storedCandidacy, published: true }]);
      mockReadBody.mockResolvedValue(
        payload({
          election_year: "2024",
          committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
          party_from_committee: true,
        }),
      );

      await handler({} as any);

      const call = vi.mocked(createRevisionTransaction).mock.calls[0]!;
      expect(call[5]).toMatchObject({
        stored: expect.objectContaining({ published: true }),
      });
      // No visibility of its own: deciding it here rather than carrying the
      // stored document's is what published/unpublished a candidacy by
      // accident.
      expect(call[5]).not.toHaveProperty("published");
      // The pointer to the old revision is not copied into the new one.
      expect(call[4]).not.toHaveProperty("revision_id");
    });

    it("says nothing when it has nothing to add", async () => {
      // Re-running the pipeline must not leave a revision per candidacy per
      // night.
      personWithStoredEdges([
        {
          ...storedCandidacy,
          committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
          party: "PiS",
        },
      ]);
      mockReadBody.mockResolvedValue(
        payload({
          election_year: "2024",
          committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
          party: "PiS",
          party_from_committee: true,
        }),
      );

      await handler({} as any);

      expect(proposeRevisionTransaction).not.toHaveBeenCalled();
      expect(createRevisionTransaction).not.toHaveBeenCalled();
    });

    it("gives two committees two candidacies, not one twice", async () => {
      // Three indistinguishable 2024 bids in one powiat are candidates for
      // every row. Without a claim per row the second would be written over
      // the document the first just took.
      personWithStoredEdges([storedCandidacy, storedCandidacy]);
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: [],
        companies: [],
        elections: [
          {
            election_type: "Samorząd",
            teryt: "1465",
            election_year: "2024",
            committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
            party_from_committee: true,
          },
          {
            election_type: "Samorząd",
            teryt: "1465",
            election_year: "2024",
            committee: "Komitet Wyborczy Nowa Lewica",
            party_from_committee: true,
          },
        ],
      });
      // The second election repeats the region lookup and the edge query.
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: { id: "teryt1465" }, id: "teryt1465" }],
      });
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [storedCandidacy, storedCandidacy].map((edge, index) => ({
          id: `stored-${index}`,
          data: () => edge,
        })),
      });

      await handler({} as any);

      expect(createRevisionTransaction).toHaveBeenCalledTimes(2);
      const targets = vi
        .mocked(createRevisionTransaction)
        .mock.calls.map((call) => (call[3] as { id: string }).id);
      expect(targets).toEqual(["stored-0", "stored-1"]);
    });

    it("does not let a bare row re-take the candidacy it just enriched", async () => {
      // The query cannot see the uncommitted batch, so the enriched edge still
      // reads back bare - and a row carrying no committee matches it exactly.
      // Taking it again would silently drop a second, real candidacy.
      personWithStoredEdges([storedCandidacy]);
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: [],
        companies: [],
        elections: [
          {
            election_type: "Samorząd",
            teryt: "1465",
            election_year: "2024",
            committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
            party_from_committee: true,
          },
          { election_type: "Samorząd", teryt: "1465", election_year: "2024" },
        ],
      });
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: { id: "teryt1465" }, id: "teryt1465" }],
      });
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: "stored-0", data: () => storedCandidacy }],
      });

      const result = await handler({} as any);

      // One enriched in place, one created as a second candidacy.
      expect(createRevisionTransaction).toHaveBeenCalledTimes(2);
      expect(result.elections).toHaveLength(2);
      const [enriched, created] = result.elections!;
      expect(enriched!.edgeId).toBe("stored-0");
      expect(created!.edgeId).not.toBe("stored-0");
    });

    it("does not create a new candidacy on top of an enriched one", async () => {
      // An enriched edge keeps the id it was created under while its fields
      // have moved on, so a later bare row hashes straight back onto it - and
      // the create path ends in a `set`, which would erase the committee.
      // The id has to be the one the bare row really computes, or this passes
      // whatever the code does.
      const enrichedId = edgeDocumentId(storedCandidacy as EdgeLike, 0);
      personWithStoredEdges([storedCandidacy], [enrichedId]);
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: [],
        companies: [],
        elections: [
          {
            election_type: "Samorząd",
            teryt: "1465",
            election_year: "2024",
            committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
            party_from_committee: true,
          },
          { election_type: "Samorząd", teryt: "1465", election_year: "2024" },
        ],
      });
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: { id: "teryt1465" }, id: "teryt1465" }],
      });
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: enrichedId, data: () => storedCandidacy }],
      });

      const result = await handler({} as any);

      // Call 0 is the enrichment of the stored edge; call 1 is the second
      // candidacy, which must not land on the document call 0 just rewrote.
      const created = vi.mocked(createRevisionTransaction).mock.calls[1]!;
      expect((created[3] as { id: string }).id).not.toBe(enrichedId);
      expect(result.elections![1]!.edgeId).not.toBe(enrichedId);
    });

    it("still creates a candidacy the database does not have", async () => {
      personWithStoredEdges([]);
      mockReadBody.mockResolvedValue(
        payload({
          election_year: "2024",
          committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
          party_from_committee: true,
        }),
      );

      await handler({} as any);

      expect(proposeRevisionTransaction).not.toHaveBeenCalled();
      expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("a person the database already has", () => {
    /** Queue a lookup that finds `nodes` already holding this person.
     *
     * The one document is the whole answer: what a revision would carry, and
     * the visibility and counters no revision carries. Both are read off it,
     * so the ingest never asks for the person a second time.
     */
    function personExists(stored: Record<string, unknown>, published = false) {
      mockGet.mockReset();
      mockDoc.mockReset();
      mockDoc.mockReturnValue({ id: "person-id", ref: mockRef });
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: "person-id",
            ref: mockRef,
            data: () => ({ ...stored, published }),
          },
        ],
      });
    }

    it("writes the party the pipeline has learned since", async () => {
      // The whole point of mapping committees to parties: 6077 people are
      // already stored, and until now nothing the pipeline learned about one
      // of them was ever written back.
      personExists({ name: "Test Person", type: "person", parties: [] });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).toHaveBeenCalledWith(
        mockDb,
        expect.anything(),
        expect.objectContaining({ uid: "test-user-id" }),
        expect.anything(),
        expect.objectContaining({ parties: ["PiS"] }),
        expect.objectContaining({ automatic: true, approve: false }),
      );
    });

    it("leaves the person in the listings they were in", async () => {
      // `/api/nodes` filters on `stats.isApproved == true`, and a Firestore
      // equality filter does not match a document that lacks the field. Losing
      // `stats` to the overwrite left five measured people published and
      // unreachable - the page was up, nothing linked to it. The endpoint hands
      // the stored document over; `createRevisionTransaction` is what carries
      // the fields through, and is covered in its own test.
      const stats = { isApproved: true, notesCount: 2, nodeGroupSize: 4 };
      personExists(
        { name: "Test Person", type: "person", parties: [], stats },
        true,
      );
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      const call = vi.mocked(createRevisionTransaction).mock.calls[0]!;
      expect(call[5]).toMatchObject({
        stored: expect.objectContaining({ stats }),
      });
      // And not restated as data: a revision describes the person, not the
      // counters something else maintains about them.
      expect(call[4]).not.toHaveProperty("stats");
    });

    it("leaves a live page live", async () => {
      // A revision is written to its target with `set`, and `published` is not
      // part of any revision, so an update that does not carry it takes the
      // page off the site. Re-running the scrapers over the 889 published
      // people did exactly that.
      personExists({ name: "Test Person", type: "person", parties: [] }, true);
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).toHaveBeenCalledWith(
        mockDb,
        expect.anything(),
        expect.objectContaining({ uid: "test-user-id" }),
        expect.anything(),
        expect.anything(),
        {
          automatic: true,
          // A live page's node is a copy of an approved revision, so the update
          // has to be approved with it rather than left pending.
          approve: true,
          // Visibility rides along with the rest of what the node owns rather
          // than being decided here.
          stored: expect.objectContaining({ published: true }),
        },
      );
    });

    it("leaves a draft a draft", async () => {
      // The other half of the same rule: learning a party about somebody
      // nobody has published must not publish them.
      personExists({ name: "Test Person", type: "person", parties: [] }, false);
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).toHaveBeenCalledWith(
        mockDb,
        expect.anything(),
        expect.objectContaining({ uid: "test-user-id" }),
        expect.anything(),
        expect.anything(),
        {
          automatic: true,
          approve: false,
          stored: expect.objectContaining({ published: false }),
        },
      );
    });

    it("keeps what it already knew", async () => {
      // A revision is written to the node wholesale, so anything the payload
      // does not mention has to be carried over or it is deleted.
      personExists({
        name: "Test Person",
        type: "person",
        parties: ["PO"],
        wikipedia: "https://pl.wikipedia.org/wiki/Test",
      });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).toHaveBeenCalledWith(
        mockDb,
        expect.anything(),
        expect.objectContaining({ uid: "test-user-id" }),
        expect.anything(),
        expect.objectContaining({
          parties: ["PO", "PiS"],
          wikipedia: "https://pl.wikipedia.org/wiki/Test",
        }),
        expect.objectContaining({ automatic: true }),
      );
    });

    it("writes nothing when it has nothing new to say", async () => {
      // Otherwise every nightly run leaves a revision on every person.
      personExists({ name: "Test Person", type: "person", parties: ["PiS"] });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).not.toHaveBeenCalled();
    });
    it("stores a birth date it has learned, once", async () => {
      // The field identity matching turns on. rejestr.io has carried one for
      // every person it names all along - 106,020 of them, 100% coverage - and
      // exactly 1 of the 6,115 stored people had one, because the payload
      // dataclass had nowhere to put it and this schema stripped it.
      personExists({ name: "Test Person", type: "person", parties: [] });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        birthDate: "1967-09-20",
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).toHaveBeenCalledWith(
        mockDb,
        expect.anything(),
        expect.objectContaining({ uid: "test-user-id" }),
        expect.anything(),
        expect.objectContaining({ birthDate: "1967-09-20" }),
        expect.objectContaining({ automatic: true }),
      );
    });

    it("does not rewrite a birth date the node already carries", async () => {
      // A date of birth does not change, so a stored one is either right or is
      // somebody's correction of the register - and unlike `wikipedia` there is
      // no version of it that gets better on the next run.
      personExists({
        name: "Test Person",
        type: "person",
        parties: [],
        birthDate: "1967-09-21",
      });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        birthDate: "1967-09-20",
        companies: [],
        elections: [],
      });

      await handler({} as any);

      // Nothing else to say either, so the run leaves no revision at all.
      expect(createRevisionTransaction).not.toHaveBeenCalled();
    });

    it("refuses a mangled birth date rather than storing it", async () => {
      // It would be written a few thousand times before anybody noticed, and
      // would match nothing.
      personExists({ name: "Test Person", type: "person", parties: [] });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        birthDate: "1967",
        companies: [],
        elections: [],
      });

      await expect(handler({} as any)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it("refuses a birth date a format check alone would let through", async () => {
      // "0202-05-27" is a well-formed ISO date and is a mangled 2002.
      personExists({ name: "Test Person", type: "person", parties: [] });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        birthDate: "0202-05-27",
        companies: [],
        elections: [],
      });

      await expect(handler({} as any)).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });
});
