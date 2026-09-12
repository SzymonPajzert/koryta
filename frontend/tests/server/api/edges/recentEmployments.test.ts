import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/recentEmployments.get";
import type { RecentEmployments } from "../../../../server/api/edges/recentEmployments.get";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

/** How many documents each scan asked for and where it resumed, so a test can
 * say the endpoint kept scanning rather than giving up on the first batch. */
const scans: { after: [string, string] | null; limit: number }[] = [];

/** A query over `edges`, built the way the endpoint builds it: two equality
 * filters, ordered by `start_date` descending, optionally resumed from a
 * two-value cursor.
 *
 * The order matters more here than in most fakes. Firestore appends `__name__`
 * in the direction of the last sort, so the real ordering is
 * (start_date desc, id desc) - and a document with no `start_date` at all is
 * not in the index and never comes back. Both are modelled, because both are
 * what the endpoint's paging correctness rests on.
 */
function edgeQuery() {
  const filters: [string, unknown][] = [];
  const orders: string[] = [];
  let after: [string, string] | null = null;
  let limit = Infinity;

  const query = {
    where: vi.fn((field: string, _op: string, value: unknown) => {
      filters.push([field, value]);
      return query;
    }),
    orderBy: vi.fn((field: unknown) => {
      orders.push(String(field));
      return query;
    }),
    startAfter: vi.fn((...values: unknown[]) => {
      // What the real client does, and the reason it is worth faking: an
      // implicit `__name__` is only added when the cursor is a document
      // snapshot, so raw values are counted against the orders actually
      // declared. One too many and `createCursor` throws rather than paging.
      if (values.length > orders.length) {
        throw new Error(
          "Too many cursor values specified. The specified values must " +
            "match the orderBy() constraints of the query.",
        );
      }
      after = [values[0] as string, values[1] as string];
      return query;
    }),
    limit: vi.fn((count: number) => {
      limit = count;
      return query;
    }),
    get: vi.fn(async () => {
      scans.push({ after, limit });
      const matching = Object.entries(edges)
        .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
        // orderBy drops a document missing the field, but an explicit null is
        // a value it sorts - last, descending - so it does come back.
        .filter(([, data]) => data.start_date !== undefined)
        .sort(([aId, a], [bId, b]) => {
          const aDate = (a.start_date ?? "") as string;
          const bDate = (b.start_date ?? "") as string;
          if (aDate !== bDate) return aDate < bDate ? 1 : -1;
          return aId < bId ? 1 : -1;
        })
        .filter(([id, data]) => {
          if (!after) return true;
          const [afterDate, afterId] = after;
          const date = (data.start_date ?? "") as string;
          return date < afterDate || (date === afterDate && id < afterId);
        })
        .slice(0, limit)
        .map(([id, data]) => ({ id, data: () => data }));
      return {
        docs: matching,
        size: matching.length,
        empty: matching.length === 0,
      };
    }),
  };
  return query;
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({ id, path: `${collection}/${id}` })),
    where: vi.fn((field: string, op: string, value: unknown) =>
      edgeQuery().where(field, op, value),
    ),
  })),
  getAll: vi.fn(async (...refs: { id: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: nodes[ref.id] !== undefined,
      data: () => nodes[ref.id],
    })),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldPath: { documentId: () => "__name__" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => false,
}));

const { mockGetValidatedQuery } = vi.hoisted(() => {
  const mockGetValidatedQuery = vi.fn();
  globalThis.getValidatedQuery = mockGetValidatedQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetValidatedQuery };
});

function request(query: Record<string, unknown> = {}) {
  mockGetValidatedQuery.mockImplementation(
    async (_event: unknown, parse: (q: unknown) => unknown) => {
      try {
        return parse(query);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

const call = () => handler({} as never) as Promise<RecentEmployments>;

/** A published employment between the two live pages the fixtures seed. */
function employment(fields: Record<string, unknown> = {}) {
  return {
    source: "anna",
    target: "orlen",
    type: "employed",
    published: true,
    start_date: "2024-01-01",
    ...fields,
  };
}

describe("api/edges/recentEmployments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scans.length = 0;
    nodes = {
      anna: { name: "Anna Nowak", type: "person", published: true },
      jan: { name: "Jan Kowalski", type: "person", published: true },
      draftPerson: { name: "Ktoś Nowy", type: "person", published: false },
      orlen: {
        name: "Orlen",
        type: "place",
        published: true,
        isPublic: true,
      },
      draftCompany: { name: "Firma Ukryta", type: "place", published: false },
    };
    edges = {};
    request();
  });

  it("names both ends of an employment and links it to the person", async () => {
    edges.e1 = employment({ name: "Prezes zarządu", end_date: "2025-06-30" });

    const { employments } = await call();

    expect(employments).toHaveLength(1);
    expect(employments[0]).toMatchObject({
      id: "e1",
      personId: "anna",
      personName: "Anna Nowak",
      companyId: "orlen",
      companyName: "Orlen",
      companyIsPublic: true,
      role: "Prezes zarządu",
      start_date: "2024-01-01",
      end_date: "2025-06-30",
    });
  });

  it("carries the employer's sectors through to the card", async () => {
    // Stored as a sanitized map, because a node written before 2026-07-28 is:
    // the card reads a plain array, so the unwrapping has to happen here.
    nodes.orlen!.categories = { "0": "energetyka", "1": "koleje" };
    edges.e1 = employment();

    const { employments } = await call();

    expect(employments[0]!.companyCategories).toEqual(["energetyka", "koleje"]);
  });

  it("says nothing about the sector of a company filed under none", async () => {
    edges.e1 = employment();

    const { employments } = await call();

    // Omitted rather than an empty array, so twenty cards do not each carry a
    // key that means nothing.
    expect(employments[0]).not.toHaveProperty("companyCategories");
  });

  /** Which odznaki reach the card.
   *
   * The home page's „Co nowego” feed is served to a logged-out visitor and to
   * Google, so this response is the only badge surface anybody sees without an
   * account - and the „proposal” and „awaiting” states exist precisely so that
   * what readers are still arguing about does not appear there under a named
   * person's name. The rule itself is `visibleBadges`, tested in
   * tests/shared/badges.test.ts; these say the endpoint asks for the public
   * slice of it and nothing wider.
   */
  describe("odznaki", () => {
    it("carries a badge the public is allowed to see", async () => {
      // „Społecznik” is the one entry in the catalogue that needs no editor -
      // it states the type of an organ rather than characterising anybody - so
      // three net votes is the whole gate it has to pass.
      nodes.anna!.stats = { badges: { spolecznik: { up: 3, down: 0 } } };
      edges.e1 = employment();

      expect((await call()).employments[0]!.badges).toEqual(["spolecznik"]);
    });

    it("says nothing about a badge one reader has proposed", async () => {
      nodes.anna!.stats = { badges: { spolecznik: { up: 1, down: 0 } } };
      edges.e1 = employment();

      // Two things at once. One reader's opinion about a named person is not
      // something a logged-out visitor may be shown at all - that is the
      // „proposal” state, signed-in only - and the key is omitted rather than
      // sent empty, like `companyCategories` above: almost nobody has a badge,
      // and this is twenty cards.
      expect((await call()).employments[0]).not.toHaveProperty("badges");
    });

    it("drops a badge an editor ruled out, whatever the count", async () => {
      // Five readers, and it still does not appear: an editor's „no” outranks
      // any number of them, which is the only thing that can be said to a
      // person who objects to a chip on their own page.
      nodes.anna!.stats = { badges: { spolecznik: { up: 5, down: 0 } } };
      nodes.anna!.badgeModeration = { spolecznik: "hidden" };
      edges.e1 = employment();

      expect((await call()).employments[0]).not.toHaveProperty("badges");
    });

    it("waits for an editor on a badge that characterises somebody", async () => {
      // Three readers are enough for the count and not for publication.
      // „Omnibus” is `requiresApproval`, so until somebody rules on it the chip
      // is „awaiting” - visible to signed-in readers on the person's own page,
      // and never in this response, which anybody can fetch.
      nodes.anna!.stats = { badges: { omnibus: { up: 3, down: 0 } } };
      edges.e1 = employment();

      expect((await call()).employments[0]).not.toHaveProperty("badges");

      nodes.anna!.badgeModeration = { omnibus: "approved" };
      expect((await call()).employments[0]!.badges).toEqual(["omnibus"]);
    });
  });

  it("puts the most recently begun spell on top", async () => {
    edges.old = employment({ start_date: "2019-05-01" });
    edges.newest = employment({ source: "jan", start_date: "2026-02-01" });
    edges.middle = employment({ start_date: "2022-11-11" });

    const { employments } = await call();

    expect(employments.map((e) => e.id)).toEqual(["newest", "middle", "old"]);
  });

  it("leaves an unpublished relation out", async () => {
    edges.hidden = employment({ published: false, start_date: "2026-12-01" });
    edges.shown = employment();

    const { employments } = await call();

    expect(employments.map((e) => e.id)).toEqual(["shown"]);
  });

  it("leaves out a relation whose person is still a draft", async () => {
    // The publish rule refuses this, and unpublishing a node cascades to its
    // edges - but the ingest can autoapprove an edge onto a draft person, so
    // the endpoint checks rather than trusting the flag on the edge.
    edges.draft = employment({ source: "draftPerson" });
    edges.live = employment({ start_date: "2020-01-01" });

    const { employments } = await call();

    expect(employments.map((e) => e.id)).toEqual(["live"]);
  });

  it("leaves out a relation whose company is still a draft", async () => {
    edges.draft = employment({ target: "draftCompany" });

    expect((await call()).employments).toEqual([]);
  });

  it("leaves out a relation whose page was removed", async () => {
    edges.gone = employment({ deleted: true });

    expect((await call()).employments).toEqual([]);
  });

  it("leaves out an edge that does not run from a person to a place", async () => {
    // A mislabelled row has nowhere to send a click.
    edges.backwards = employment({ source: "orlen", target: "anna" });
    edges.dangling = employment({ target: "nie-ma-takiego" });

    expect((await call()).employments).toEqual([]);
  });

  it("says nothing about a role nobody recorded", async () => {
    edges.e1 = employment();

    expect((await call()).employments[0]!.role).toBeNull();
  });

  it("reads a spell that has not ended as still running", async () => {
    edges.e1 = employment();

    expect((await call()).employments[0]!.end_date).toBeNull();
  });

  it("hands back a cursor that resumes without repeating or skipping", async () => {
    for (let i = 0; i < 5; i++) {
      edges[`e${i}`] = employment({
        start_date: `202${i}-01-01`,
        source: i % 2 === 0 ? "anna" : "jan",
      });
    }
    request({ limit: 2 });

    const first = await call();
    expect(first.employments.map((e) => e.id)).toEqual(["e4", "e3"]);
    expect(first.nextCursor).toBe("2023-01-01|e3");

    request({ limit: 2, cursor: first.nextCursor! });
    const second = await call();
    expect(second.employments.map((e) => e.id)).toEqual(["e2", "e1"]);

    request({ limit: 2, cursor: second.nextCursor! });
    const third = await call();
    expect(third.employments.map((e) => e.id)).toEqual(["e0"]);
    expect(third.nextCursor).toBeNull();
  });

  it("separates two spells that began on the same day", async () => {
    // Every row of a KRS batch carries the same start, so a cursor made of the
    // date alone would resume at the top of the group and loop.
    edges.b = employment({ start_date: "2024-03-01" });
    edges.a = employment({ start_date: "2024-03-01", source: "jan" });
    request({ limit: 1 });

    const first = await call();
    expect(first.employments.map((e) => e.id)).toEqual(["b"]);
    expect(first.nextCursor).toBe("2024-03-01|b");

    request({ limit: 1, cursor: first.nextCursor! });
    expect((await call()).employments.map((e) => e.id)).toEqual(["a"]);
  });

  it("keeps scanning past a batch that filtered away to nothing", async () => {
    // The cursor follows what was examined rather than what was returned. A
    // page filled halfway through a batch that then jumped to the end of it
    // would drop every employment behind the break, silently.
    for (let i = 0; i < 70; i++) {
      edges[`draft${String(i).padStart(3, "0")}`] = employment({
        source: "draftPerson",
        start_date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }
    edges.buried = employment({ start_date: "2001-01-01" });

    const { employments } = await call();

    expect(employments.map((e) => e.id)).toEqual(["buried"]);
    expect(scans.length).toBeGreaterThan(1);
  });

  it("never orders on a field the index cannot serve", async () => {
    // An employment with no start date is not in the index and cannot appear -
    // the same 195-odd hand entered edges the pipeline invariants budget for.
    edges.undated = employment({ start_date: undefined });
    edges.dated = employment();

    expect((await call()).employments.map((e) => e.id)).toEqual(["dated"]);
  });

  it("skips a spell whose start date was written as an explicit null", async () => {
    // /api/edges/create writes null for a blank date field, and null is a value
    // the index sorts rather than one it drops - so unlike an absent date this
    // one does come back, sorting last. It cannot be a cursor and it cannot be
    // rendered as a period, so it is passed over.
    edges.blank = { ...employment(), start_date: null };
    edges.dated = employment();

    const { employments } = await call();

    expect(employments.map((e) => e.id)).toEqual(["dated"]);
  });

  it("refuses a page size the feed was not designed to serve", async () => {
    request({ limit: 500 });

    await expect(call()).rejects.toMatchObject({ statusCode: 400 });
  });
});
