import { describe, it, expect, vi, beforeEach } from "vitest";
import { baseNodeFields } from "../../../../server/utils/revisions";
import handler from "../../../../server/api/revisions/create.post";

const mockSet = vi.fn();
const mockCommit = vi.fn();
const mockDoc = vi.fn();
/** What `revisions/<deterministic id>` holds. Empty unless a test says the
 * caller has proposed this before. */
const mockGet = vi.fn();
const mockDb = {
  collection: vi.fn(() => ({ doc: mockDoc })),
  batch: vi.fn(() => ({ set: mockSet, commit: mockCommit })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => "timestamp" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "test-user-id" }),
}));

vi.mock("../../../../server/utils/revisions", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/revisions")
  >()),
  baseNodeFields: vi.fn().mockResolvedValue({}),
}));

const { mockReadBody } = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.readBody = mockReadBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockReadBody };
});

/** The revision document the handler wrote. */
function writtenRevision() {
  return mockSet.mock.calls[0]![1];
}

/** The node document the handler wrote, when it created one. The revision is
 * written first, so the node is the second `set`. */
function writtenNode() {
  return mockSet.mock.calls[1]?.[1];
}

describe("api/revisions/create, place edits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ exists: false });
    mockDoc.mockImplementation((id?: string) => ({
      id: id ?? "generated-id",
      get: mockGet,
    }));
  });

  it("records who answered the ownership question", async () => {
    // The marker is what stops the next company ingest, which has no way of
    // seeing a spółka akcyjna's shareholders, from writing its guess over this.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Małopolska Agencja Rozwoju Regionalnego",
      isPublic: false,
    });
    mockReadBody.mockResolvedValue({
      node_id: "marr",
      name: "Małopolska Agencja Rozwoju Regionalnego",
      isPublic: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      type: "place",
      isPublic: true,
      isPublicSource: "manual",
    });
  });

  it("leaves an unanswered question unanswered", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Ministerstwo Infrastruktury",
    });
    // The description is what this proposal is really for. Something has to
    // change, or the handler turns it down as a restatement of the entry.
    mockReadBody.mockResolvedValue({
      node_id: "ministerstwo",
      name: "Ministerstwo Infrastruktury",
      content: "Resort odpowiedzialny za kolej.",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).not.toHaveProperty("isPublic");
    expect(writtenRevision().data).not.toHaveProperty("isPublicSource");
  });

  it("records that a person set the categories, so an ingest leaves them", async () => {
    // The pipelines derive categories from PKD codes, and a code says what a
    // company does rather than what sector it is in. Whoever corrected it on
    // the page outranks them, and the marker is what `ingest/company` checks.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "PKP Informatyka",
      categories: [],
    });
    mockReadBody.mockResolvedValue({
      node_id: "pkp-informatyka",
      name: "PKP Informatyka",
      categories: ["koleje"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      type: "place",
      categories: ["koleje"],
      categoriesSource: "manual",
    });
  });

  it("pins an emptied category set as firmly as a filled one", async () => {
    // Clearing is the only way to correct a company the pipelines filed under
    // the wrong sector - Kopalnia Wapienia Czatkowice declares rail freight
    // because it owns a siding - so an empty array has to set the marker too.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Kopalnia Wapienia Czatkowice",
      categories: ["koleje"],
    });
    mockReadBody.mockResolvedValue({
      node_id: "czatkowice",
      name: "Kopalnia Wapienia Czatkowice",
      categories: [],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      categories: [],
      categoriesSource: "manual",
    });
  });

  it("does not claim a person set categories they never mentioned", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Szpital Powiatowy",
      categories: ["szpitale"],
    });
    mockReadBody.mockResolvedValue({
      node_id: "szpital",
      name: "Szpital Powiatowy w Wołowie",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    // The stored set is still carried through - a revision is a whole snapshot
    // - but nothing claims a person decided it.
    expect(writtenRevision().data).toMatchObject({ categories: ["szpitale"] });
    expect(writtenRevision().data).not.toHaveProperty("categoriesSource");
  });

  it("rejects a category the site does not offer", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Port Lotniczy Poznań-Ławica",
    });
    mockReadBody.mockResolvedValue({
      node_id: "lawica",
      name: "Port Lotniczy Poznań-Ławica",
      categories: ["lotniska"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "Nieznana kategoria",
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("does not let a person edit smuggle in a category", async () => {
    // `personEditSchema` has no `categories`, and parsing against the schema is
    // what strips it - the same guard that stops `revision_id` being smuggled.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "person",
      name: "Jan Kowalski",
    });
    mockReadBody.mockResolvedValue({
      node_id: "jan",
      name: "Jan Kowalski",
      content: "Poseł.",
      categories: ["koleje"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).not.toHaveProperty("categories");
    expect(writtenRevision().data).not.toHaveProperty("categoriesSource");
  });

  it("does not let a person edit smuggle in an ownership flag", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "person",
      name: "Jan Kowalski",
    });
    mockReadBody.mockResolvedValue({
      node_id: "jan",
      name: "Jan Kowalski",
      content: "Poseł.",
      isPublic: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).not.toHaveProperty("isPublic");
    expect(writtenRevision().data).not.toHaveProperty("isPublicSource");
  });

  it("stores REGON and NIP for a place that is not in KRS", async () => {
    // The only identifiers a wojewódzki fundusz, a ministry or an urząd has:
    // none of them register with a court, so `krsNumber` stays empty forever.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "WFOŚiGW Zielona Góra",
    });
    mockReadBody.mockResolvedValue({
      node_id: "wfosigw",
      name: "WFOŚiGW Zielona Góra",
      // Accepted as printed, stored as bare digits.
      regonNumber: "123 456 785",
      nipNumber: "PL 526-025-02-74",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      regonNumber: "123456785",
      nipNumber: "5260250274",
    });
  });

  it("rejects an identifier whose check digit does not match", async () => {
    // Both registers checksum their numbers, so a typo is caught here rather
    // than stored as a plausible number that resolves to nobody.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "WFOŚiGW Zielona Góra",
    });
    mockReadBody.mockResolvedValue({
      node_id: "wfosigw",
      name: "WFOŚiGW Zielona Góra",
      regonNumber: "123456784",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "Numer REGON jest niepoprawny",
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("keeps the fields it was not given", async () => {
    // A revision is a whole snapshot written with `set`, so anything the form
    // does not carry has to come from the stored node.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Tramwaje Śląskie",
      krsNumber: "0000145278",
      activity: ["49.31.Z"],
    });
    mockReadBody.mockResolvedValue({
      node_id: "tramwaje",
      name: "Tramwaje Śląskie",
      krsNumber: "0000145278",
      isPublic: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      krsNumber: "0000145278",
      activity: { "0": "49.31.Z" },
    });
  });
});

describe("api/revisions/create, proposing a new entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ exists: false });
    mockDoc.mockImplementation((id?: string) => ({
      id: id ?? "generated-id",
      get: mockGet,
    }));
  });

  it("creates a place with the fields a place has", async () => {
    // Every new entry used to be written as a person whatever the form said,
    // so a proposed company lost its KRS number and turned up as a politician.
    mockReadBody.mockResolvedValue({
      type: "place",
      name: "Lubelskie Koleje sp. z o.o.",
      krsNumber: "0000999888",
      isPublic: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      type: "place",
      name: "Lubelskie Koleje sp. z o.o.",
      krsNumber: "0000999888",
      isPublic: true,
      isPublicSource: "manual",
    });
  });

  it("gives a new entry the stats that make it findable", async () => {
    // Not cosmetic. /api/search sorts on `stats.nodeGroupSize`, and Firestore's
    // orderBy drops a document that does not carry the field at all - so a
    // person somebody had just created was invisible to the very picker that
    // created them, and stayed invisible until /api/stats/computeNodes next
    // ran. Verified against the emulator: adding the field, even as 0, is what
    // makes them come back.
    mockReadBody.mockResolvedValue({ type: "person", name: "Zenon Nowy" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenNode()).toMatchObject({
      name: "Zenon Nowy",
      published: false,
      stats: { isApproved: false, nodeGroupSize: 0 },
    });
  });

  it("creates an article with the address it lives at", async () => {
    mockReadBody.mockResolvedValue({
      type: "article",
      name: "Żona byłego sekretarza generalnego PiS w radzie nadzorczej",
      sourceURL: "https://wiadomosci.wp.pl/lubelskie-koleje",
      shortName: "WP",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      type: "article",
      sourceURL: "https://wiadomosci.wp.pl/lubelskie-koleje",
      shortName: "WP",
    });
  });

  it("insists an article carries a usable address", async () => {
    mockReadBody.mockResolvedValue({
      type: "article",
      name: "Artykuł",
      sourceURL: "wiadomosci.wp.pl",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("falls back to a person for a type nobody may propose", async () => {
    // Regions come from TERYT and carry the ids the rest of the data joins on.
    mockReadBody.mockResolvedValue({
      type: "region",
      name: "Województwo Wymyślone",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({ type: "person" });
  });

  it("still defaults to a person when no type is given", async () => {
    mockReadBody.mockResolvedValue({ name: "Sylwia Sobolewska" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({ type: "person" });
  });
});

describe("api/revisions/create, proposing a removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ exists: false });
    mockDoc.mockImplementation((id?: string) => ({
      id: id ?? "generated-id",
      get: mockGet,
    }));
  });

  it("keeps the removal and its reason", async () => {
    // Both fields were stripped by the edit schema, so "zaproponuj usunięcie"
    // filed a revision identical to the entry it wanted taken down.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "person",
      name: "Jan Kowalski",
    });
    mockReadBody.mockResolvedValue({
      node_id: "jan",
      deleted: true,
      delete_reason: "Duplikat",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      type: "person",
      name: "Jan Kowalski",
      deleted: true,
      delete_reason: "Duplikat",
    });
    expect(writtenRevision().status).toBe("pending");
  });

  it("insists on a reason", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "person",
      name: "Jan Kowalski",
    });
    mockReadBody.mockResolvedValue({
      node_id: "jan",
      deleted: true,
      delete_reason: "  ",
    });

    // Falls through to the edit schema, which wants a name it was not given.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe("api/revisions/create, the same change twice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ exists: false });
    mockDoc.mockImplementation((id?: string) => ({
      id: id ?? "generated-id",
      get: mockGet,
    }));
  });

  /** The id the handler addresses a restatement by. Written by the same
   * proposer, against the same entry, saying the same thing. */
  function proposedRevisionId() {
    return mockDoc.mock.calls
      .map(([id]) => id)
      .find((id) => typeof id === "string" && id.startsWith("proposal_"));
  }

  it("files a first proposal under an id derived from what it says", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Tramwaje Śląskie",
    });
    mockReadBody.mockResolvedValue({
      node_id: "tramwaje",
      name: "Tramwaje Śląskie S.A.",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handler({} as any);

    const id = proposedRevisionId();
    expect(id).toMatch(/^proposal_tramwaje_test-user-id_/);
    expect(result).toMatchObject({ id, duplicate: false });
    expect(mockCommit).toHaveBeenCalled();
  });

  it("hands back the waiting proposal instead of filing it again", async () => {
    // What went wrong on /instytucja: the page showed no trace of the change
    // that had just been proposed, so the same correction was sent several
    // times and the queue filled up with copies of it.
    mockGet.mockResolvedValue({
      exists: true,
      id: "proposal_tramwaje_test-user-id_abcdefghij",
      data: () => ({ status: "pending" }),
    });
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Tramwaje Śląskie",
    });
    mockReadBody.mockResolvedValue({
      node_id: "tramwaje",
      name: "Tramwaje Śląskie S.A.",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handler({} as any);

    expect(result).toEqual({
      id: "proposal_tramwaje_test-user-id_abcdefghij",
      node_id: "tramwaje",
      duplicate: true,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("lets a rejected proposal be made again, without overwriting it", async () => {
    // The rejection is a record with a reason in it, and the contributor is
    // entitled to ask a second time - so the restatement is its own document.
    mockGet.mockResolvedValue({
      exists: true,
      id: "proposal_tramwaje_test-user-id_abcdefghij",
      data: () => ({ status: "rejected", reject_reason: "brak źródła" }),
    });
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Tramwaje Śląskie",
    });
    mockReadBody.mockResolvedValue({
      node_id: "tramwaje",
      name: "Tramwaje Śląskie S.A.",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handler({} as any);

    expect(result.id).toBe("generated-id");
    expect(result.duplicate).toBe(false);
    expect(mockCommit).toHaveBeenCalled();
  });

  it("turns down a proposal that says what the entry already says", async () => {
    // The form arrives prefilled, so "Zaproponuj" pressed after changing
    // nothing filed a revision a reviewer had to open to find empty.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Tramwaje Śląskie",
      categories: ["koleje"],
      categoriesSource: "manual",
    });
    mockReadBody.mockResolvedValue({
      node_id: "tramwaje",
      name: "Tramwaje Śląskie",
      categories: ["koleje"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "Ta propozycja niczego nie zmienia - wpis już to zawiera.",
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("still takes a restatement that pins a pipeline's guess", async () => {
    // Same categories, but saying them by hand is what sets
    // `categoriesSource: "manual"` and stops the next ingest overwriting them.
    // That is a change, and turning it down would take the only way of
    // confirming what a pipeline guessed.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Tramwaje Śląskie",
      categories: ["koleje"],
    });
    mockReadBody.mockResolvedValue({
      node_id: "tramwaje",
      name: "Tramwaje Śląskie",
      categories: ["koleje"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      categories: ["koleje"],
      categoriesSource: "manual",
    });
  });

  it("addresses a new entry by nothing in particular", async () => {
    // There is no entry to restate a proposal about, and two people proposing
    // the same company are proposing two of them.
    mockReadBody.mockResolvedValue({ type: "place", name: "Nowa Spółka" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handler({} as any);

    expect(proposedRevisionId()).toBeUndefined();
    expect(result.id).toBe("generated-id");
  });
});
