import { describe, it, expect, vi, beforeEach } from "vitest";
import { baseNodeFields } from "../../../../server/utils/revisions";
import handler from "../../../../server/api/revisions/create.post";

const mockSet = vi.fn();
const mockCommit = vi.fn();
const mockDoc = vi.fn();
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

describe("api/revisions/create, place edits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.mockImplementation((id?: string) => ({ id: id ?? "generated-id" }));
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
    mockReadBody.mockResolvedValue({
      node_id: "ministerstwo",
      name: "Ministerstwo Infrastruktury",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).not.toHaveProperty("isPublic");
    expect(writtenRevision().data).not.toHaveProperty("isPublicSource");
  });

  it("does not let a person edit smuggle in an ownership flag", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "person",
      name: "Jan Kowalski",
    });
    mockReadBody.mockResolvedValue({
      node_id: "jan",
      name: "Jan Kowalski",
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
    mockDoc.mockImplementation((id?: string) => ({ id: id ?? "generated-id" }));
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
    mockDoc.mockImplementation((id?: string) => ({ id: id ?? "generated-id" }));
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
