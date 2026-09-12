import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../../../server/api/edges/serviceMilestones.get";
import type { ServiceMilestones } from "../../../../server/api/edges/serviceMilestones.get";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

/** A query over `edges`, built the way the endpoint builds it. The same fake
 * `recentEmployments.test.ts` uses, and for the same reason: both handlers
 * page through the one index, and a document with no `start_date` is not in it
 * and never comes back. */
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
      if (values.length > orders.length) {
        throw new Error("Too many cursor values specified.");
      }
      after = [values[0] as string, values[1] as string];
      return query;
    }),
    limit: vi.fn((count: number) => {
      limit = count;
      return query;
    }),
    get: vi.fn(async () => {
      const matching = Object.entries(edges)
        .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
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

/** Field masks the endpoint asked for, so a test can say it is not pulling
 * whole node documents into the cache. */
const fieldMasks: (string[] | undefined)[] = [];

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({ id, path: `${collection}/${id}` })),
    where: vi.fn((field: string, op: string, value: unknown) =>
      edgeQuery().where(field, op, value),
    ),
  })),
  getAll: vi.fn(async (...args: unknown[]) => {
    const last = args[args.length - 1] as { fieldMask?: string[] } | undefined;
    const hasOptions = !!last && !("id" in last);
    fieldMasks.push(hasOptions ? last.fieldMask : undefined);
    const refs = (hasOptions ? args.slice(0, -1) : args) as { id: string }[];
    return refs.map((ref) => ({
      id: ref.id,
      exists: nodes[ref.id] !== undefined,
      data: () => nodes[ref.id],
    }));
  }),
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
  // The window is computed once a day behind nitro's cache; a unit test runs
  // the function itself, which is what lets `vi.setSystemTime` move the day.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = ((fn: any) => fn) as any;
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

const call = () => handler({} as never) as Promise<ServiceMilestones>;

/** A published post between the two live pages the fixtures seed. */
function employment(fields: Record<string, unknown> = {}) {
  return {
    source: "anna",
    target: "orlen",
    type: "employed",
    published: true,
    start_date: "2016-09-09",
    ...fields,
  };
}

describe("api/edges/serviceMilestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fieldMasks.length = 0;
    // Midday in Warsaw on 9 September 2026.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));
    nodes = {
      anna: {
        name: "Anna Nowak",
        type: "person",
        published: true,
        parties: ["PiS"],
      },
      jan: { name: "Jan Kowalski", type: "person", published: true },
      draftPerson: { name: "Ktoś Nowy", type: "person", published: false },
      orlen: { name: "Orlen", type: "place", published: true, isPublic: true },
      pkp: { name: "PKP", type: "place", published: true, isPublic: true },
      szpital: {
        name: "Szpital Powiatowy",
        type: "place",
        published: true,
        isPublic: true,
        supervisoryBody: "rada-spoleczna",
      },
      prywatna: {
        name: "Firma Prywatna",
        type: "place",
        published: true,
        isPublic: false,
      },
      draftCompany: { name: "Firma Ukryta", type: "place", published: false },
    };
    edges = {};
    request();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the day an unbroken career reaches a whole number of years", async () => {
    edges.e1 = employment({ start_date: "2016-09-09", name: "Prezes zarządu" });

    const { milestones, today } = await call();

    expect(today).toBe("2026-09-09");
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({
      id: "anna:10",
      personId: "anna",
      personName: "Anna Nowak",
      parties: ["PiS"],
      years: 10,
      date: "2026-09-09",
      daysFromToday: 0,
      companyId: "orlen",
      companyName: "Orlen",
      role: "Prezes zarządu",
      alsoHeld: 0,
      institutions: 1,
      spells: 1,
    });
  });

  it("counts the whole career, not one post", async () => {
    // The difference from a post anniversary: neither of these two jobs is ten
    // years old, but together they are.
    edges.first = employment({
      start_date: "2016-09-09",
      end_date: "2021-09-09",
    });
    edges.second = employment({
      target: "pkp",
      start_date: "2021-09-09",
      name: "Rada Nadzorcza",
    });

    const { milestones } = await call();

    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({
      years: 10,
      date: "2026-09-09",
      companyName: "PKP",
      institutions: 2,
      spells: 1,
    });
  });

  it("folds two posts held at once into one stretch of service", async () => {
    // Otherwise holding three seats for a year would read as three years, and
    // this is a site about people who hold several at once.
    edges.a = employment({ start_date: "2016-09-09" });
    edges.b = employment({ target: "pkp", start_date: "2018-01-01" });

    const { milestones } = await call();

    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({
      years: 10,
      date: "2026-09-09",
      institutions: 2,
      // Both were being held that day; the longer-running one is named.
      companyName: "Orlen",
      alsoHeld: 1,
    });
  });

  it("pushes the date back by however long the career was interrupted", async () => {
    // Five years, three out, then back: the tenth year lands three years after
    // the tenth anniversary of the first day, and saying so is the whole point
    // of the page.
    edges.first = employment({
      start_date: "2013-09-09",
      end_date: "2018-09-09",
    });
    edges.second = employment({ target: "pkp", start_date: "2021-09-09" });

    const { milestones } = await call();

    expect(milestones[0]).toMatchObject({
      years: 10,
      date: "2026-09-09",
      spells: 2,
    });
  });

  it("says a date still to come rests on the post staying held", async () => {
    edges.e1 = employment({ start_date: "2016-09-20" });

    expect((await call()).milestones[0]).toMatchObject({
      years: 10,
      date: "2026-09-20",
      projected: true,
    });
  });

  it("does not call a date already past a projection", async () => {
    edges.e1 = employment({ start_date: "2016-08-20" });
    request({ scope: "past" });

    expect((await call()).milestones[0]).toMatchObject({
      date: "2026-08-20",
      projected: false,
    });
  });

  it("never promises a milestone a finished career fell short of", async () => {
    // Nine and a bit years, ended two years ago. There is no tenth.
    edges.e1 = employment({
      start_date: "2015-01-01",
      end_date: "2024-06-01",
    });

    expect((await call()).milestones).toEqual([]);
  });

  it("leaves out a seat nobody is paid to sit on", async () => {
    // Out of `experienceMonths` too, so counting it here would move the date
    // off the career the rest of the site reports.
    edges.paid = employment({ start_date: "2016-09-09" });
    edges.unpaid = employment({
      target: "szpital",
      name: "Rada Nadzorcza",
      start_date: "2006-01-01",
    });

    const { milestones } = await call();

    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({ years: 10, institutions: 1 });
  });

  it("leaves out anything but a known public institution", async () => {
    edges.priv = employment({ target: "prywatna", start_date: "2006-01-01" });
    edges.pub = employment({ start_date: "2016-09-09" });

    expect((await call()).milestones[0]).toMatchObject({
      years: 10,
      institutions: 1,
    });
  });

  it("leaves out a person or a company that is still a draft", async () => {
    edges.draftP = employment({ source: "draftPerson" });
    edges.draftC = employment({ target: "draftCompany" });
    edges.unpublished = employment({ published: false });
    edges.removed = employment({ deleted: true });

    expect((await call()).milestones).toEqual([]);
  });

  it("reaches a month either way and no further", async () => {
    edges.inside = employment({ start_date: "2016-08-10" });
    edges.ahead = employment({ source: "jan", start_date: "2016-10-09" });
    edges.tooFar = employment({ target: "pkp", start_date: "2016-10-10" });

    expect((await call()).milestones.map((m) => m.personId)).toEqual(["jan"]);

    request({ scope: "past" });
    expect((await call()).milestones.map((m) => m.personId)).toEqual(["anna"]);
  });

  it("opens each half on the day next to today", async () => {
    edges.past = employment({ start_date: "2016-08-20" });
    edges.soon = employment({ source: "jan", start_date: "2016-10-01" });

    const upcoming = await call();
    expect(upcoming).toMatchObject({ scope: "upcoming", total: 1, past: 1 });
    expect(upcoming.milestones[0]!.daysFromToday).toBe(22);

    request({ scope: "past" });
    const past = await call();
    expect(past).toMatchObject({ scope: "past", total: 1, upcoming: 1 });
    expect(past.milestones[0]!.daysFromToday).toBe(-20);
  });

  it("answers `recent` with today and everything behind it, newest first", async () => {
    // What the home page's feed asks for. It runs backwards from today, so a
    // date still ahead of us would sort above every card around it and read
    // as news.
    nodes.ewa = { name: "Ewa Zaradna", type: "person", published: true };
    edges.today = employment();
    edges.past = employment({ source: "jan", start_date: "2016-08-20" });
    edges.ahead = employment({
      source: "ewa",
      target: "pkp",
      start_date: "2016-10-01",
    });

    request({ scope: "recent" });
    const recent = await call();

    expect(recent.milestones.map((m) => m.personName)).toEqual([
      "Anna Nowak",
      "Jan Kowalski",
    ]);
    expect(recent.milestones.map((m) => m.daysFromToday)).toEqual([0, -20]);
    // A different question, not a third piece of the partition, so the two
    // counts the toggle on /eksploruj/staz labels itself with are unchanged -
    // and today is still in both `recent` and `upcoming`.
    expect(recent).toMatchObject({ scope: "recent", total: 2, upcoming: 2 });
    expect(recent.past).toBe(1);
  });

  it("reads only the node fields it draws with", async () => {
    // It has to fetch every node the published employments touch - ~2,500
    // documents against the 3,047 published `employed` edges of 2026-09-09 -
    // and the result sits in nitro's in-memory cache. Masking changes no read
    // count, since Firestore bills a document rather than a field; what it
    // keeps down is the size of that cached copy.
    edges.e1 = employment();

    await call();

    expect(fieldMasks.length).toBeGreaterThan(0);
    expect(fieldMasks[0]).toContain("isPublic");
    // The two inputs `publicBadgeIds` takes, each as its own narrow path, and
    // the `stats` block never as a whole: it also holds the per-category vote
    // aggregates and the activity counters, which no card draws, and that
    // block is most of what the mask exists to leave behind.
    //
    // Three lines rather than the single `not.toContain("stats")` this test
    // made before the badges existed. `toContain` on an array compares
    // elements literally, so the moment the mask gained "stats.badges" that
    // line went on passing without saying anything about it - and a mask that
    // had dropped both badge paths, which is how the endpoint would silently
    // stop sending badges at all, is precisely what it could not see.
    expect(fieldMasks[0]).toContain("stats.badges");
    expect(fieldMasks[0]).toContain("badgeModeration");
    expect(fieldMasks[0]).not.toContain("stats");
  });

  it("carries the employer's sectors through to the card", async () => {
    // Stored as a sanitized map, because a node written before 2026-07-28 is.
    nodes.orlen!.categories = { "0": "energetyka" };
    edges.e1 = employment();

    const { milestones } = await call();

    expect(milestones[0]!.companyCategories).toEqual(["energetyka"]);
  });

  /** Which odznaki reach the card.
   *
   * /eksploruj/staz and the home page's „Co nowego” feed are both served to a
   * logged-out visitor and to Google, so these responses are the only badge
   * surface anybody sees without an account. The rule itself is `visibleBadges`
   * and lives in shared/badges.ts, tested in tests/shared/badges.test.ts; these
   * say the endpoint asks for the public slice of it and nothing wider. The
   * same four cases are made against /api/edges/recentEmployments, because the
   * home feed merges the two lists and one of them leaking would look exactly
   * like the other doing it.
   *
   * The fake `getAll` above hands back the whole fixture whatever mask it was
   * given, so these say nothing about the two badge fields being *asked* for -
   * that half is „reads only the node fields it draws with”, and without it a
   * mask that had dropped them would leave every test here green while the
   * live endpoint sent no badges at all.
   */
  describe("odznaki", () => {
    beforeEach(() => {
      // Ten years to the day, so there is exactly one card to read the badges
      // off - the same milestone the first test in this file pins.
      edges.e1 = employment({ start_date: "2016-09-09" });
    });

    it("carries a badge the public is allowed to see", async () => {
      // „Społecznik” is the one entry in the catalogue that needs no editor -
      // it states the type of an organ rather than characterising anybody - so
      // three net votes is the whole gate it has to pass.
      nodes.anna!.stats = { badges: { spolecznik: { up: 3, down: 0 } } };

      expect((await call()).milestones[0]!.badges).toEqual(["spolecznik"]);
    });

    it("says nothing about a badge one reader has proposed", async () => {
      nodes.anna!.stats = { badges: { spolecznik: { up: 1, down: 0 } } };

      // Two things at once. One reader's opinion about a named person is not
      // something a logged-out visitor may be shown at all - that is the
      // „proposal” state, signed-in only - and the key is omitted rather than
      // sent empty, like `companyCategories`: almost nobody has a badge, and
      // the feed is twenty cards.
      expect((await call()).milestones[0]).not.toHaveProperty("badges");
    });

    it("drops a badge an editor ruled out, whatever the count", async () => {
      // Five readers, and it still does not appear: an editor's „no” outranks
      // any number of them, which is the only thing that can be said to a
      // person who objects to a chip on their own page.
      nodes.anna!.stats = { badges: { spolecznik: { up: 5, down: 0 } } };
      nodes.anna!.badgeModeration = { spolecznik: "hidden" };

      expect((await call()).milestones[0]).not.toHaveProperty("badges");
    });

    it("waits for an editor on a badge that characterises somebody", async () => {
      // Three readers are enough for the count and not for publication.
      // „Omnibus” is `requiresApproval`, so until somebody rules on it the chip
      // is „awaiting” - visible to signed-in readers on the person's own page,
      // and never in this response, which anybody can fetch.
      nodes.anna!.stats = { badges: { omnibus: { up: 3, down: 0 } } };

      expect((await call()).milestones[0]).not.toHaveProperty("badges");

      nodes.anna!.badgeModeration = { omnibus: "approved" };
      expect((await call()).milestones[0]!.badges).toEqual(["omnibus"]);
    });
  });

  it("pages by offset without repeating or skipping", async () => {
    for (let i = 0; i < 5; i++) {
      nodes[`p${i}`] = { name: `Osoba ${i}`, type: "person", published: true };
      edges[`e${i}`] = employment({
        source: `p${i}`,
        start_date: `2016-09-0${i + 1}`,
      });
    }
    request({ limit: 2, scope: "past" });

    const first = await call();
    expect(first.total).toBe(5);
    expect(first.nextOffset).toBe(2);

    request({ limit: 2, offset: 2, scope: "past" });
    const second = await call();

    request({ limit: 2, offset: 4, scope: "past" });
    const third = await call();
    expect(third.nextOffset).toBeNull();

    expect(
      [...first.milestones, ...second.milestones, ...third.milestones].map(
        (m) => m.id,
      ),
    ).toEqual(["p4:10", "p3:10", "p2:10", "p1:10", "p0:10"]);
  });

  it("asks Warsaw what day it is, not the server", async () => {
    vi.setSystemTime(new Date("2026-09-09T22:30:00Z"));

    expect((await call()).today).toBe("2026-09-10");
  });

  it("refuses a page size or a half it does not have", async () => {
    request({ limit: 500 });
    await expect(call()).rejects.toMatchObject({ statusCode: 400 });

    request({ scope: "wszystkie" });
    await expect(call()).rejects.toMatchObject({ statusCode: 400 });
  });
});
