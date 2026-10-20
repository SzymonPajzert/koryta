import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/search.get";

const { mockCollection, mockWhere, mockOrderBy, mockLimit, mockGet } =
  vi.hoisted(() => {
    globalThis.defineCachedEventHandler = (fn: any) => fn;
    globalThis.defineCachedFunction = (fn: any) => fn;
    globalThis.useEvent = () => ({ path: "/mock" });
    globalThis.defineEventHandler = (fn: any) => fn;
    globalThis.setResponseHeader = () => {};
    globalThis.getQuery = (event: any) => event.query ?? {};

    const mockGet = vi.fn();
    const query = {
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      get: mockGet,
    };
    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const mockCollection = vi.fn().mockReturnValue(query);

    return {
      mockCollection,
      mockWhere: query.where,
      mockOrderBy: query.orderBy,
      mockLimit: query.limit,
      mockGet,
    };
  });

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn().mockReturnValue({ collection: mockCollection }),
}));

vi.mock("h3", () => ({
  getValidatedQuery: async (event: any, parser: any) => parser(event.query),
  getQuery: (event: any) => event.query ?? {},
}));

// The real `editorFreshCachedEventHandler` and `wantsLatest` run here, so the
// token is what this stands in for: a bearer header is a signed in reader,
// anything else is nobody.
vi.mock("../../../server/utils/auth", () => ({
  getOptionalUser: async (event: any) =>
    event.headers?.authorization ? { uid: "reader" } : null,
}));

/** A node as `parseNodeDoc` will see it coming back from Firestore. */
const doc = (
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  data: () => ({ name, type: "person", published: true, ...extra }),
});

/** The docs each `array-contains` chunk answers with, so a test can describe
 * the index rather than the order the endpoint happens to query it in. */
const respondWith = (byChunk: Record<string, ReturnType<typeof doc>[]>) => {
  let chunk = "";
  mockWhere.mockImplementation((field: string, _op: string, value: string) => {
    if (field === "nameChunksLower") chunk = value;
    return {
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockGet,
    };
  });
  mockGet.mockImplementation(async () => ({ docs: byChunk[chunk] ?? [] }));
};

const search = (q: string) => handler({ query: { q }, context: {} } as any);

/** The same search from a signed in reader: `latest` and the token with it,
 * as `authHeaders` sends them. */
const searchSignedIn = (q: string) =>
  handler({
    query: { q, latest: "true" },
    headers: { authorization: "Bearer token" },
    context: {},
  } as any);

describe("/api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrderBy.mockReturnValue({
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockGet,
    });
    mockLimit.mockReturnValue({
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockGet,
    });
  });

  it("finds a person by first and last name past their middle one", async () => {
    // The index carries no chunk spanning the middle name, so the only thing
    // "andrzej namysło" can be answered by is the surname plus a check here.
    respondWith({ namysło: [doc("a1", "Andrzej Józef Namysło")] });

    const results = await search("Andrzej Namysło");

    expect(results.map((r) => r.name)).toEqual(["Andrzej Józef Namysło"]);
  });

  it("anchors the second pass on the rarest word it can pick", async () => {
    respondWith({});
    await search("Andrzej Namysło");

    const chunks = mockWhere.mock.calls
      .filter(([field]) => field === "nameChunksLower")
      .map(([, , value]) => value);
    expect(chunks).toEqual(["andrzej namysło", "namysło"]);
  });

  it("drops the names the anchor pulled in that were not asked for", async () => {
    // Every Namysło comes back off the anchor; only one of them is Andrzej.
    respondWith({
      namysło: [
        doc("a1", "Barbara Namysło"),
        doc("a2", "Andrzej Józef Namysło"),
      ],
    });

    const results = await search("Andrzej Namysło");

    expect(results.map((r) => r.name)).toEqual(["Andrzej Józef Namysło"]);
  });

  it("puts an exact prefix of the name ahead of a looser hit", async () => {
    respondWith({
      "andrzej namysło": [doc("a2", "Andrzej Namysło")],
      namysło: [
        doc("a1", "Andrzej Józef Namysło"),
        doc("a2", "Andrzej Namysło"),
      ],
    });

    const results = await search("Andrzej Namysło");

    expect(results.map((r) => r.id)).toEqual(["a2", "a1"]);
  });

  it("asks the index once for a single word", async () => {
    respondWith({ namysło: [doc("a1", "Andrzej Józef Namysło")] });

    const results = await search("Namysło");

    const chunks = mockWhere.mock.calls
      .filter(([field]) => field === "nameChunksLower")
      .map(([, , value]) => value);
    expect(chunks).toEqual(["namysło"]);
    expect(results).toHaveLength(1);
  });

  it("finds a page titled with the hyphen by its halves typed apart", async () => {
    // The person ingest renames "Kupczak Wiśniowska" to the hyphen PKW gives,
    // and "bogusława kupczak wiśniowska" is no prefix of her name any more.
    respondWith({
      wiśniowska: [doc("a1", "Bogusława Kupczak-Wiśniowska")],
    });

    const results = await search("Kupczak Wiśniowska");

    expect(results.map((r) => r.id)).toEqual(["a1"]);
  });

  it("finds a page titled with a space by the hyphen typed", async () => {
    // One word as typed, two as the hyphen cuts it: the index is asked for
    // the whole word, which a page titled with the hyphen carries, and for
    // its longer half, which the page titled with a space does.
    respondWith({
      "kupczak-wiśniowska": [doc("a1", "Bogusława Kupczak-Wiśniowska")],
      wiśniowska: [
        doc("a2", "Bogusława Kupczak Wiśniowska"),
        doc("a3", "Anna Wiśniowska"),
      ],
    });

    const results = await search("Kupczak-Wiśniowska");

    const chunks = mockWhere.mock.calls
      .filter(([field]) => field === "nameChunksLower")
      .map(([, , value]) => value);
    expect(chunks).toEqual(["kupczak-wiśniowska", "wiśniowska"]);
    expect(results.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("anchors on a part of the hyphenated word typed, not a longer common one", async () => {
    // "przedsiębiorstwo" is the longest of the words the hyphen cuts, and 697
    // companies carry it: the 500 read off it end before this one does.
    respondWith({
      przedsiębiorstwo: [doc("p1", "PRZEDSIĘBIORSTWO KOMUNALNE")],
      produkcyjne: [
        doc("p2", "ZAMOJSKIE PRZEDSIĘBIORSTWO USŁUGOWO-PRODUKCYJNE"),
      ],
    });

    const results = await search("Przedsiębiorstwo Usługowo-Produkcyjne");

    const chunks = mockWhere.mock.calls
      .filter(([field]) => field === "nameChunksLower")
      .map(([, , value]) => value);
    expect(chunks).toEqual([
      "przedsiębiorstwo usługowo-produkcyjne",
      "produkcyjne",
    ]);
    expect(results.map((r) => r.id)).toEqual(["p2"]);
  });

  it("ignores the padding around a typed query", async () => {
    respondWith({ nowak: [doc("a1", "Anna Nowak")] });

    // "nowak " was searched for literally, and is a chunk of nobody.
    expect(await search("  Nowak ")).toHaveLength(1);
  });

  it("asks for the top of the collection when nothing is typed", async () => {
    respondWith({ "": [doc("a1", "Anna Nowak")] });

    expect(await search("")).toHaveLength(1);
  });

  it("does not offer a page that was merged away as a duplicate", async () => {
    // A tombstone keeps its `nameChunksLower` - nothing clears them, and the
    // trigger keeps them in step with the name it still has - so the index
    // goes on answering with that name. Offering it sends the reader to a
    // redirect, and puts the duplicate back in front of them under the very
    // name the merge was meant to stop showing twice.
    respondWith({
      "roman ludwiczuk": [
        doc("dup", "Roman Ludwiczuk", {
          deleted: true,
          merged_into: "keep",
          published: false,
        }),
        doc("keep", "Roman Ludwiczuk"),
      ],
    });

    expect((await search("Roman Ludwiczuk")).map((r: any) => r.id)).toEqual([
      "keep",
    ]);
  });

  it("still offers a signed in reader a page nobody has published yet", async () => {
    // They may have created it a moment ago; for them only a removal takes a
    // page out of the index, not a draft.
    respondWith({
      "anna nowak": [doc("draft", "Anna Nowak", { published: false })],
    });

    expect((await searchSignedIn("Anna Nowak")).map((r: any) => r.id)).toEqual([
      "draft",
    ]);
  });

  it("offers a logged out reader an unpublished person, marked, after the published", async () => {
    // Their page is a teaser now - the name and the latest post, never a
    // party - with a way to sign in for the rest, rather than the 404 that got
    // drafts taken out of the box. Published pages still come first: nine in
    // ten people are drafts, and the full page is the better answer.
    respondWith({
      "anna nowak": [
        doc("draft", "Anna Nowak", { published: false }),
        doc("live", "Anna Nowakowska"),
      ],
    });

    expect(
      (await search("Anna Nowak")).map((r: any) => [r.id, r.published]),
    ).toEqual([
      ["live", true],
      ["draft", false],
    ]);
  });

  it("offers a logged out reader a person added by hand as well", async () => {
    // The box names them and nothing else, and their page asks the reader to
    // sign in. Asking how each page was written, as the teaser does, kept out
    // the people added by hand because readers searched for them.
    respondWith({
      "anna nowak": [
        doc("added-by-hand", "Anna Nowak", { published: false }),
        doc("imported", "Anna Nowakowska", { published: false }),
      ],
    });

    expect((await search("Anna Nowak")).map((r: any) => r.id)).toEqual([
      "added-by-hand",
      "imported",
    ]);
    expect(mockCollection).not.toHaveBeenCalledWith("revisions");
  });

  it("keeps every other unpublished page from a logged out reader", async () => {
    // A company or a region nobody has published is still only a 404 to them.
    respondWith({
      energa: [
        doc("draft-company", "Energa", { type: "place", published: false }),
        doc("live-company", "Energa Operator", { type: "place" }),
      ],
    });

    expect((await search("Energa")).map((r: any) => r.id)).toEqual([
      "live-company",
    ]);
  });

  it("keeps a signed in reader's hits in the index's order", async () => {
    // They open drafts like any page, so a draft is not pushed down for them.
    respondWith({
      "anna nowak": [
        doc("draft", "Anna Nowak", { published: false }),
        doc("live", "Anna Nowakowska"),
      ],
    });

    expect((await searchSignedIn("Anna Nowak")).map((r: any) => r.id)).toEqual([
      "draft",
      "live",
    ]);
  });

  it("keeps an unpublished company from a logged out reader who types `latest` too", async () => {
    // The flag without a token is a request, not a permission.
    respondWith({
      energa: [
        doc("draft-company", "Energa", { type: "place", published: false }),
      ],
    });

    const result = await handler({
      query: { q: "Energa", latest: "true" },
      context: {},
    } as any);
    expect(result).toEqual([]);
  });

  it("reads further down the hits for a logged out reader", async () => {
    // Their drafts are dropped after the query, so the top twenty of a common
    // name could otherwise be twenty pages they cannot open.
    respondWith({ kowalski: [doc("live", "Jan Kowalski")] });

    await search("Kowalski");
    expect(mockLimit).toHaveBeenCalledWith(200);

    vi.clearAllMocks();
    respondWith({ kowalski: [doc("live", "Jan Kowalski")] });
    await searchSignedIn("Kowalski");
    expect(mockLimit).toHaveBeenCalledWith(20);
  });
});
