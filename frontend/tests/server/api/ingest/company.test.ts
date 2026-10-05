import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRevisionTransaction } from "../../../../server/utils/revisions";
import handler, {
  SKARB_PANSTWA_NODE_ID,
} from "../../../../server/api/ingest/company.post";

// Mock dependencies
const mockGet = vi.fn();
const mockLimit = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockBatch = vi.fn();
const mockCommit = vi.fn();
// A real DocumentReference knows which collection it is in, and
// `revisionChangesNothing` asks - a node carries counters an edge does not.
const nodesParent = { id: "nodes" };
const mockRef = { id: "doc-ref-id", parent: nodesParent };

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
  parent: nodesParent,
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

/** The uploader's account, which is in the datascience group. */
const caller = { uid: "test-user-id", datascience: true };

// `withoutInternalFields` is pure and is what decides which of the stored
// company's fields the revision carries, so the test wants the real one.
vi.mock("../../../../server/utils/revisions", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/revisions")
  >()),
  createRevisionTransaction: vi.fn(),
}));

const { mockReadBody } = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.readBody = mockReadBody;
  globalThis.createError = (err: any) => err;
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.readValidatedBody = async (event: any, parse: any) => {
    const body = await mockReadBody();
    try {
      return parse(body);
    } catch {
      throw { statusCode: 400, message: "Missing required fields (krs, name)" };
    }
  };
  return { mockReadBody };
});

describe("api/ingest/company", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(caller);
    // Reset query chain mocks
    mockWhere.mockReturnValue(queryMock);
    queryMock.where.mockReturnValue(queryMock);
    queryMock.limit.mockReturnValue(queryMock);
  });

  it("refuses a caller who is not in the datascience group", async () => {
    // Being logged in is not enough: the revision this writes goes onto the
    // node unreviewed, so any account could rename or publish a company.
    mockGetUser.mockResolvedValue({ uid: "test-user-id" });
    mockReadBody.mockResolvedValue({ krs: "12345", name: "Inna nazwa" });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(createRevisionTransaction).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("should throw 400 if krs is missing", async () => {
    mockReadBody.mockResolvedValue({ name: "Test Company" });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "Missing required fields (krs, name)",
    });
  });

  it("should create a new company if it doesn't exist", async () => {
    mockReadBody.mockResolvedValue({ krs: "12345", name: "New Company" });
    mockGet.mockResolvedValue({ empty: true, docs: [] });
    // doc() returns a reference, not an object containing ref
    mockDoc.mockReturnValue(mockRef);

    const result = await handler({} as any);

    expect(mockCollection).toHaveBeenCalledWith("nodes");
    expect(mockDoc).toHaveBeenCalled(); // Should call doc() for new ID
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      mockRef,
      {
        name: "New Company",
        type: "place",
        krsNumber: "12345",
      },
      { automatic: true, approve: true, published: true },
    );
    // ref.id is accessed in handler return statement
    expect(result).toEqual({ id: "doc-ref-id", code: 200, company: "created" });
  });

  it("should re-approve an already-public existing company", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Updated Company",
    });

    const existingRef = { id: "existing-id", parent: nodesParent };
    const existingDoc = {
      ref: existingRef,
      // published => the company is currently live, and a re-ingest keeps it so
      data: () => ({
        content: "Old Content",
        revision_id: "rev-1",
        published: true,
      }),
    };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [existingDoc],
    });

    const result = await handler({} as any);

    expect(mockDoc).not.toHaveBeenCalled(); // Should use existing doc ref
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef, // Expect the ref from the doc
      {
        // Layered over what is stored, so a field the payload says nothing
        // about is not deleted by the write.
        content: "Old Content",
        name: "Updated Company",
        type: "place",
        krsNumber: "12345",
      },
      {
        automatic: true,
        approve: true, // already public => stays public
        published: true,
        stored: expect.objectContaining({ published: true }),
      },
    );
    expect(result).toEqual({
      id: "existing-id",
      code: 200,
      company: "updated",
    });
  });

  it("should keep a pending existing company pending", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Updated Company",
    });

    const existingRef = { id: "existing-id", parent: nodesParent };
    const existingDoc = {
      ref: existingRef,
      // no revision_id => the company is still pending / unapproved
      data: () => ({ content: "Old Content" }),
    };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [existingDoc],
    });

    const result = await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef,
      {
        content: "Old Content",
        name: "Updated Company",
        type: "place",
        krsNumber: "12345",
      },
      {
        automatic: true,
        approve: false, // pending => not force-published
        published: false,
        stored: expect.objectContaining({ content: "Old Content" }),
      },
    );
    expect(result).toEqual({
      id: "existing-id",
      code: 200,
      company: "updated",
    });
  });

  it("should keep an approved-but-unpublished company hidden", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Updated Company",
    });

    const existingRef = { id: "existing-id", parent: nodesParent };
    const existingDoc = {
      ref: existingRef,
      // approved revision exists, but the node was explicitly unpublished
      data: () => ({ revision_id: "rev-1", published: false }),
    };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [existingDoc],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef,
      {
        name: "Updated Company",
        type: "place",
        krsNumber: "12345",
      },
      {
        automatic: true,
        approve: false, // hidden => not force-published
        published: false,
        stored: expect.objectContaining({ published: false }),
      },
    );
  });

  it("should store isPublic when is_public is provided", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Public Company",
      is_public: true,
    });
    mockGet.mockResolvedValue({ empty: true, docs: [] });
    mockDoc.mockReturnValue(mockRef);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      mockRef,
      {
        name: "Public Company",
        type: "place",
        krsNumber: "12345",
        isPublic: true,
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("should leave a manually set isPublic alone", async () => {
    // KRS cannot see who owns a spółka akcyjna, so a re-ingest that found no
    // public owner must not overturn somebody who knew there was one. The
    // answer is read off the stored document the KRS lookup already returned.
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Public Company",
      is_public: false,
    });
    const existingRef = { id: "existing-id", parent: nodesParent };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({
            isPublic: true,
            isPublicSource: "manual",
            published: true,
          }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef,
      {
        name: "Public Company",
        type: "place",
        krsNumber: "12345",
        isPublic: true,
        isPublicSource: "manual",
      },
      expect.objectContaining({ automatic: true }),
    );
  });

  it("stores the categories the pipelines worked out", async () => {
    // The site used to derive these from the PKD codes below. It does not any
    // more - a register code says what a company does rather than what sector
    // it is in - so the answer arrives already decided, from
    // `data/pipelines/src/entities/company_categories.py`.
    mockReadBody.mockResolvedValue({
      krs: "0000076705",
      name: "PKP Szybka Kolej Miejska w Trójmieście",
      activity: ["49.12.Z", "49.31.Z"],
      categories: ["koleje"],
    });
    mockGet.mockResolvedValue({ empty: true, docs: [] });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      expect.anything(),
      {
        name: "PKP Szybka Kolej Miejska w Trójmieście",
        type: "place",
        krsNumber: "0000076705",
        activity: ["49.12.Z", "49.31.Z"],
        categories: ["koleje"],
      },
      expect.objectContaining({ automatic: true }),
    );
  });

  it("stores an empty category set, which is an answer and not a gap", async () => {
    // Instytut Badawczy Dróg i Mostów carries 42.12 among ten construction
    // codes. The pipelines decided it is in no sector, and that has to reach
    // the node - otherwise a company can never lose a category it was given.
    mockReadBody.mockResolvedValue({
      krs: "0000158240",
      name: "Instytut Badawczy Dróg i Mostów",
      activity: ["72.19.Z", "42.12.Z"],
      categories: [],
    });
    const existingRef = { id: "existing-id", parent: nodesParent };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({ categories: ["koleje"], published: true }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef,
      expect.objectContaining({ categories: [] }),
      expect.objectContaining({ automatic: true }),
    );
  });

  it("stores the organ that supervises an SPZOZ", async () => {
    // KRS 0000079907: the register's dzial2.organNadzoru is a "RADA SPOŁECZNA",
    // and rejestr.io reports its members under the same connection type as any
    // board, so the edges say "Rada Nadzorcza". The node is what tells the site
    // otherwise - see `data/pipelines/src/entities/company_bodies.py`.
    mockReadBody.mockResolvedValue({
      krs: "0000079907",
      name: "SP ZOZ Szpital Specjalistyczny nr I w Bytomiu",
      categories: ["szpitale"],
      supervisory_body: "rada-spoleczna",
    });
    mockGet.mockResolvedValue({ empty: true, docs: [] });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      expect.anything(),
      expect.objectContaining({ supervisoryBody: "rada-spoleczna" }),
      expect.objectContaining({ automatic: true }),
    );
  });

  it("clears the organ when the payload says the form has none worth naming", async () => {
    // The empty string is the pipelines saying they read `formaPrawna` and it
    // is an ordinary company, which has to be able to undo a value written
    // before the mapping was corrected.
    mockReadBody.mockResolvedValue({
      krs: "0000076705",
      name: "PKP Szybka Kolej Miejska w Trójmieście",
      supervisory_body: "",
    });
    const existingRef = { id: "existing-id" };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({ supervisoryBody: "rada-spoleczna", published: true }),
        },
      ],
    });

    await handler({} as any);

    const revisionData = vi.mocked(createRevisionTransaction).mock.calls[0]![4];
    expect(revisionData).not.toHaveProperty("supervisoryBody");
  });

  it("leaves the stored organ alone when the payload states none", async () => {
    // A company created because somebody works there arrives from a pipeline
    // that never read its legal form; silence is not "it has no organ".
    mockReadBody.mockResolvedValue({
      krs: "0000079907",
      name: "SP ZOZ Szpital Specjalistyczny nr I w Bytomiu",
    });
    const existingRef = { id: "existing-id" };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({ supervisoryBody: "rada-spoleczna", published: true }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef,
      expect.objectContaining({ supervisoryBody: "rada-spoleczna" }),
      expect.objectContaining({ automatic: true }),
    );
  });

  it("leaves the stored categories alone when the payload states none", async () => {
    // A payload from a pipeline that does not compute categories at all - the
    // person uploader creating a missing employer, say - must not be read as
    // "this company belongs to nothing".
    mockReadBody.mockResolvedValue({
      krs: "0000076705",
      name: "PKP Szybka Kolej Miejska w Trójmieście",
      activity: ["49.12.Z"],
    });
    const existingRef = { id: "existing-id", parent: nodesParent };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({ categories: ["koleje"], published: true }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef,
      expect.objectContaining({ categories: ["koleje"] }),
      expect.objectContaining({ automatic: true }),
    );
  });

  it("should leave manually set categories alone", async () => {
    // The same contract `isPublic` has: the pipelines see PKD codes, a reader
    // can see the company. Whoever answered on the page outranks them, and an
    // empty answer is as binding as a full one.
    mockReadBody.mockResolvedValue({
      krs: "0000073875",
      name: "Kopalnia Wapienia Czatkowice",
      activity: ["08.11.Z", "49.20.Z"],
      categories: ["koleje"],
    });
    const existingRef = { id: "existing-id", parent: nodesParent };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({
            categories: [],
            categoriesSource: "manual",
            published: true,
          }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef,
      {
        name: "Kopalnia Wapienia Czatkowice",
        type: "place",
        krsNumber: "0000073875",
        activity: ["08.11.Z", "49.20.Z"],
        categories: [],
        categoriesSource: "manual",
      },
      expect.objectContaining({ automatic: true }),
    );
  });

  it("stores the legal form and the organ the register names", async () => {
    // Both are carried for display on /eksploruj/szpitale. Neither decides
    // anything: what follows from the form about pay is `supervisoryBody`,
    // which the pipelines send separately.
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "SZPITAL POWIATOWY W GRÓJCU",
      legal_form: "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
      supervisory_organ: "rada_spoleczna",
    });
    mockGet.mockResolvedValue({ empty: true, docs: [] });
    mockDoc.mockReturnValue(mockRef);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      mockRef,
      {
        name: "SZPITAL POWIATOWY W GRÓJCU",
        type: "place",
        krsNumber: "12345",
        legalForm: "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
        supervisoryOrgan: "rada_spoleczna",
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("leaves a stored supervisory organ alone when the payload says nothing", async () => {
    // A revision is written to the node wholesale, so a payload from a pipeline
    // that predates the field must not clear what an earlier run stored.
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Szpital sp. z o.o.",
    });
    const existingRef = { id: "existing-id" };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({
            legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            supervisoryOrgan: "rada_nadzorcza",
            published: true,
          }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      caller,
      existingRef,
      {
        name: "Szpital sp. z o.o.",
        type: "place",
        krsNumber: "12345",
        legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        supervisoryOrgan: "rada_nadzorcza",
      },
      expect.objectContaining({ automatic: true }),
    );
  });

  it("rejects an organ name the site does not understand", async () => {
    // An enum rather than a free string, so a value nothing can filter on is a
    // 400 rather than a row that quietly never matches. Safe only because the
    // scrapers' normalisation is total - every unrecognised name folds to
    // "inny". `supervisory_body` beside it is deliberately *not* an enum, for
    // the reason `categories` is not.
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Test Company",
      supervisory_organ: "RADA SPOŁECZNA",
    });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("should create edges for owned companies", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Parent Company",
      owners: ["67890"],
    });

    // Parent query: Empty (creating new parent)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const parentRef = { id: "parent-id" };
    mockDoc.mockReturnValueOnce(parentRef);

    // Child query: Found
    const childRef = { id: "child-id" };
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ ref: childRef, data: () => ({}) }],
    });

    // createEdge first checks whether the link already exists.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const edgeRef = { id: "edge-id" };
    mockDoc.mockReturnValueOnce(edgeRef);

    await handler({} as any);

    // Verify Edge Creation
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      caller,
      edgeRef,
      {
        source: "child-id",
        target: "parent-id",
        type: "owns",
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("should create edge to region if teryt is provided", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const companyRef = { id: "company-id" };
    mockDoc.mockReturnValueOnce(companyRef);

    const regionSnapshot = { exists: true, ref: { id: "teryt1061" } };
    const regionRefMock = {
      id: "teryt1061",
      get: vi.fn().mockResolvedValue(regionSnapshot),
    };

    mockDoc.mockReturnValueOnce(regionRefMock);

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const edgeRef = { id: "edge-region-id" };
    mockDoc.mockReturnValueOnce(edgeRef);
    await handler({} as any);
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      caller,
      edgeRef,
      {
        source: "teryt1061",
        target: "company-id",
        type: "seat",
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("skips an owner the site does not have instead of rejecting the company", async () => {
    // The register names 238 companies as shareholders that koryta.pl does not
    // track. This used to throw the 404 out of the handler, so a company whose
    // parent is missing was rejected whole and lost its categories and its seat
    // over the one edge that could not be drawn - 266 of 3,928 in a real run.
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Child Company",
      owners: ["99999"],
    });

    // Mock Child get (will create new)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "child-id" });

    // Mock Parent get -> returns empty
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const result = await handler({} as any);

    expect(result).toMatchObject({ id: "child-id", code: 200 });
    // The company's own revision, and no ownership edge.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("links a Treasury-owned company to the Skarb Państwa node", async () => {
    // The one owner that can only be named by a node id: no KRS number, and no
    // TERYT either, because the Treasury is not a territory. The pipeline sends
    // a flag; the id lives in the handler.
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Polska Grupa Zbrojeniowa",
      owner_skarb_panstwa: true,
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: SKARB_PANSTWA_NODE_ID,
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await handler({} as any);

    // The company, and the ownership edge beside it.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createRevisionTransaction).mock.calls[1]![4]).toEqual({
      source: SKARB_PANSTWA_NODE_ID,
      target: "company-id",
      type: "owns",
    });
  });

  it("skips the Treasury edge where that node does not exist", async () => {
    // A local stack seeded by `scripts/seed-emulator.ts` has no such node, and
    // an edge pointing at a document that is not there draws as a nameless dot
    // and folds into every employee's targetNodeIds.
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Polska Grupa Zbrojeniowa",
      owner_skarb_panstwa: true,
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: SKARB_PANSTWA_NODE_ID,
      get: vi.fn().mockResolvedValue({ exists: false }),
    });

    await handler({} as any);

    // The company's own revision, and nothing else.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("draws no Treasury edge when the register names no such owner", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Prywatna Sp. z o.o.",
    });
    // `...Once`: `beforeEach` clears calls but not implementations, so a
    // default set here would leak into the next test.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("leaves a stored seat alone when the register names a different region", async () => {
    // A company has one registered seat, so a second from a different region is
    // a disagreement rather than a second fact. 13 companies on the site have a
    // stored seat that predates the current register and is simply wrong;
    // writing the right one beside it would leave them with two.
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt1061",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    // A seat is already stored, from somewhere else entirely.
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: "stale",
          data: () => ({
            source: "teryt1261",
            target: "company-id",
            type: "seat",
          }),
        },
      ],
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({ region: "existing" });
    // The company's own revision only; no second seat.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("writes the seat when the conflicting one has been removed", async () => {
    // /api/edges/delete is a soft delete, so the stale seat is still a
    // document. Reading it as a competing claim would make the ingest refuse
    // the correct seat forever, on the strength of a relation an admin has
    // already taken off the graph.
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt1061",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: "stale",
          data: () => ({
            source: "teryt1261",
            target: "company-id",
            type: "seat",
            deleted: true,
          }),
        },
      ],
    });
    // `findEdge` for the seat about to be written, and the pre-split `owns`
    // lookup behind it: neither exists. `...Once` rather than setting the
    // default - `beforeEach` clears calls but not implementations, so a default
    // set here would leak into the next test.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const result = await handler({} as any);

    expect(result).toMatchObject({ region: "added" });
    // The company, and the seat beside it.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(2);
  });

  it("falls back to the powiat when the exact teryt has no node", async () => {
    // A seat TERYT comes from geonames and is six digits, WOJ+POW+GMI with no
    // RODZ, so it matches no node - `Regions` mints gminy with the RODZ on the
    // end. The powiat above it is where the site records a seat anyway.
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061999", // > 4 chars
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const companyRef = { id: "company-id" };
    mockDoc.mockReturnValueOnce(companyRef);

    // The exact code first, and nothing has it.
    mockDoc.mockReturnValueOnce({
      id: "teryt1061999",
      get: vi.fn().mockResolvedValue({ exists: false }),
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    // Then the powiat, which does.
    const regionSnapshot = { exists: true, ref: { id: "teryt1061" } };
    const regionRefMock = {
      id: "teryt1061",
      get: vi.fn().mockResolvedValue(regionSnapshot),
    };
    mockDoc.mockReturnValueOnce(regionRefMock);

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const edgeRef = { id: "edge-region-id" };
    mockDoc.mockReturnValueOnce(edgeRef);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      caller,
      edgeRef,
      {
        source: "teryt1061", // Must have correctly sliced
        target: "company-id",
        type: "seat",
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("reports an unmappable region instead of failing the whole ingest", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Unknown Region Company",
      teryt: "9999",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });

    // Mock region missing
    const missingRegionSnapshot = { exists: false };
    const regionRefMock = {
      get: vi.fn().mockResolvedValue(missingRegionSnapshot),
    };
    mockDoc.mockReturnValueOnce(regionRefMock);

    // Mock the fallback query missing
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    // The company's other fields are still worth storing, so the ingest
    // succeeds and only the location is reported as unresolved.
    const result = await handler({} as any);
    expect(result).toMatchObject({ code: 200, region: "unknown" });
    // Only the node revision was written - no edge.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });
  it("derives the edge id from the link, so a re-run cannot duplicate it", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt1061",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    // Two lookups: no `seat` edge, and no pre-split `owns` one either.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "edge-region-id" });

    await handler({} as any);

    expect(mockDoc).toHaveBeenCalledWith("edge_teryt1061_company-id_seat");
  });

  it("links a government shareholder by its own TERYT, not the company's", async () => {
    // The register names the owner and gives no code, so the pipelines resolve
    // the name. Gmina Miasta Gdansk holds 10.7% of PKP SKM, which is seated in
    // Gdynia: the owner edge and the seat edge run from different regions, and
    // before the split there was one type for both.
    mockReadBody.mockResolvedValue({
      krs: "0000076705",
      name: "PKP SKM w Trojmiescie",
      owner_teryts: ["2261011"],
      teryt: "2262",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    // the owner region
    mockDoc.mockReturnValueOnce({
      id: "teryt2261011",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "edge-owner-id" });
    // the seat region
    mockDoc.mockReturnValueOnce({
      id: "teryt2262",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "edge-seat-id" });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      caller,
      { id: "edge-owner-id" },
      { source: "teryt2261011", target: "company-id", type: "owns" },
      { automatic: true, approve: true, published: true },
    );
    expect(createRevisionTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      caller,
      { id: "edge-seat-id" },
      { source: "teryt2262", target: "company-id", type: "seat" },
      { automatic: true, approve: true, published: true },
    );
  });

  it("reports an owner TERYT with no region node instead of failing", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Gmina-owned Company",
      owner_teryts: ["9999999"],
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt9999999",
      get: vi.fn().mockResolvedValue({ exists: false }),
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({ code: 200 });
    // Node revision only; no edge to a region that does not exist.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("skips a seat already stored as a pre-split owns edge", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt1061",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    // No `seat` edge yet, but the pair already carries a pre-split `owns` one -
    // which is how all 3,939 seats are stored until
    // `scripts/migrate/split-seat-edges.ts` has run. Writing a `seat` edge
    // beside it would give the company two seats, and the ingest runs nightly,
    // so it would win the race against the migration.
    // Three lookups now: is there a seat from another region, is there a `seat`
    // edge for this pair, is there a pre-split `owns` one.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: "legacy",
          data: () => ({
            source: "teryt1061",
            target: "company-id",
            type: "owns",
          }),
        },
      ],
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({ region: "existing" });
    // Node revision only; no second edge.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("skips the edge even when the stored one carries stray fields", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt1061",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    // A seat is a state edge: the region either seats the company or it does
    // not, so a date somebody once put on the link does not make a second one.
    // Three lookups now: is there a seat from another region, is there a `seat`
    // edge for this pair, is there a pre-split `owns` one.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: "dated",
          data: () => ({
            source: "teryt1061",
            target: "company-id",
            type: "owns",
            start_date: "2020-01-01",
          }),
        },
      ],
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({ region: "existing" });
    // Node revision only; no second link.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("api/ingest/company, re-run over a company nothing has changed", () => {
  /** The node as a previous run of the same payload left it. */
  const storedCompany = {
    name: "PKP Szybka Kolej Miejska w Trójmieście",
    type: "place",
    krsNumber: "0000076705",
    activity: ["49.12.Z", "49.31.Z"],
    categories: ["koleje"],
    isPublic: true,
    published: true,
    revision_id: "rev-1",
    stats: { nodeGroupSize: 4, isApproved: true },
  };

  const payload = {
    krs: "0000076705",
    name: "PKP Szybka Kolej Miejska w Trójmieście",
    activity: ["49.12.Z", "49.31.Z"],
    categories: ["koleje"],
    is_public: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(caller);
    mockWhere.mockReturnValue(queryMock);
    queryMock.where.mockReturnValue(queryMock);
    queryMock.limit.mockReturnValue(queryMock);
  });

  function storedAs(data: Record<string, unknown>) {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        { ref: { id: "existing-id", parent: nodesParent }, data: () => data },
      ],
    });
  }

  it("writes no revision at all", async () => {
    // `CompaniesPayloads` re-submits every company the site holds on every run.
    // Before this the register standing still still cost each of them a
    // revision document and a rewrite of the node.
    mockReadBody.mockResolvedValue(payload);
    storedAs(storedCompany);

    const result = await handler({} as any);

    expect(createRevisionTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: "existing-id",
      code: 200,
      company: "unchanged",
    });
  });

  it("writes as soon as the payload has learned one thing", async () => {
    mockReadBody.mockResolvedValue({
      ...payload,
      categories: ["koleje", "szpitale"],
    });
    storedAs(storedCompany);

    const result = await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ company: "updated" });
  });

  it("still writes a company whose counters nothing has filled in", async () => {
    // The write seeds them, and `/api/nodes` filters every listing on
    // `stats.isApproved` - so skipping here would leave the company on the site
    // and out of every list that leads to it.
    const { stats: _none, ...withoutStats } = storedCompany;
    mockReadBody.mockResolvedValue(payload);
    storedAs(withoutStats);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("still writes a live company with no approved revision to point at", async () => {
    // Live but never approved: the write is what would give the node its
    // `revision_id`, so it has to happen even though the data matches.
    const { revision_id: _none, ...noPointer } = storedCompany;
    mockReadBody.mockResolvedValue(payload);
    storedAs(noPointer);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not restate a pending company to its reviewer either", async () => {
    // A company awaiting review gets a `pending` revision rather than an
    // approved one, and there is nothing for it to point at - but a second
    // revision saying what the first one says is one more thing in the queue
    // and no more information in it.
    const { revision_id: _none, ...pending } = storedCompany;
    mockReadBody.mockResolvedValue(payload);
    storedAs({
      ...pending,
      published: false,
      stats: { nodeGroupSize: 4, isApproved: false },
    });

    await handler({} as any);

    expect(createRevisionTransaction).not.toHaveBeenCalled();
  });
});
