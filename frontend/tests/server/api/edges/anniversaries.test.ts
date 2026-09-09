import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../../../server/api/edges/anniversaries.get";
import type { WorkAnniversaries } from "../../../../server/api/edges/anniversaries.get";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

/** A query over `edges`, built the way the endpoint builds it: two equality
 * filters, ordered by `start_date` descending, optionally resumed from a
 * two-value cursor. The same fake `recentEmployments.test.ts` uses, and for
 * the same reason - both handlers page through that one index, and a document
 * with no `start_date` is not in it and never comes back.
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
  // The window is computed once a day and cached under the Warsaw date. The
  // cache is nitro's, so a unit test runs the function itself - which is what
  // lets `vi.setSystemTime` move the day between cases.
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

const call = () => handler({} as never) as Promise<WorkAnniversaries>;

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

describe("api/edges/anniversaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Midday in Warsaw on 9 September 2026, so that a case moving the clock
    // forward a few hours does not roll the day by accident.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));
    nodes = {
      anna: {
        name: "Anna Nowak",
        type: "person",
        published: true,
        parties: ["PiS"],
        stats: { edges: { approved: { experienceMonths: 12.4 } } },
      },
      jan: {
        name: "Jan Kowalski",
        type: "person",
        published: true,
        stats: { edges: { approved: { experienceMonths: 3 } } },
      },
      bezStatystyk: { name: "Ktoś Bez Stat", type: "person", published: true },
      draftPerson: { name: "Ktoś Nowy", type: "person", published: false },
      orlen: { name: "Orlen", type: "place", published: true, isPublic: true },
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
      nieznana: { name: "Firma Nieznana", type: "place", published: true },
      draftCompany: { name: "Firma Ukryta", type: "place", published: false },
    };
    edges = {};
    request();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names both ends and says which anniversary it is", async () => {
    edges.e1 = employment({ name: "Prezes zarządu" });

    const { anniversaries, today } = await call();

    expect(today).toBe("2026-09-09");
    expect(anniversaries).toHaveLength(1);
    expect(anniversaries[0]).toMatchObject({
      id: "e1",
      personId: "anna",
      personName: "Anna Nowak",
      parties: ["PiS"],
      companyId: "orlen",
      companyName: "Orlen",
      companyIsPublic: true,
      role: "Prezes zarządu",
      start_date: "2016-09-09",
      ongoing: true,
      date: "2026-09-09",
      years: 10,
      daysFromToday: 0,
      experienceYears: 12.4,
    });
  });

  it("totals the career rather than the post", async () => {
    // The two numbers on a card are different questions: `years` is this seat,
    // `experienceYears` is every public post the person has ever held.
    edges.e1 = employment({ start_date: "2020-09-20" });

    const [row] = (await call()).anniversaries;

    expect(row!.years).toBe(6);
    expect(row!.experienceYears).toBe(12.4);
  });

  it("reports no experience for a person computeNodes has never reached", async () => {
    edges.e1 = employment({ source: "bezStatystyk" });

    expect((await call()).anniversaries[0]!.experienceYears).toBe(0);
  });

  it("runs from the ones already past into the ones still to come", async () => {
    edges.past = employment({ start_date: "2010-08-20" });
    edges.todays = employment({ start_date: "2016-09-09" });
    edges.soon = employment({ start_date: "2001-10-01" });

    const { anniversaries } = await call();

    expect(anniversaries.map((a) => a.id)).toEqual(["past", "todays", "soon"]);
    expect(anniversaries.map((a) => a.daysFromToday)).toEqual([-20, 0, 22]);
  });

  it("puts the longer service first when two fall on one day", async () => {
    edges.shorter = employment({ start_date: "2024-09-15" });
    edges.longer = employment({ source: "jan", start_date: "2001-09-15" });

    expect((await call()).anniversaries.map((a) => a.id)).toEqual([
      "longer",
      "shorter",
    ]);
  });

  it("reaches a month either way and no further", async () => {
    edges.inside = employment({ start_date: "2000-08-10" });
    edges.outside = employment({ start_date: "2000-08-09" });
    edges.ahead = employment({ start_date: "2000-10-09" });
    edges.tooFarAhead = employment({ start_date: "2000-10-10" });

    expect((await call()).anniversaries.map((a) => a.id)).toEqual([
      "inside",
      "ahead",
    ]);
  });

  it("is not an anniversary until a year has gone by", async () => {
    // The day a post began is what /api/edges/recentEmployments is for. A
    // "0th anniversary" would put every recent hire on this page twice over.
    edges.thisYear = employment({ start_date: "2026-09-20" });
    edges.lastYear = employment({ start_date: "2025-09-20" });

    const { anniversaries } = await call();

    expect(anniversaries.map((a) => a.id)).toEqual(["lastYear"]);
    expect(anniversaries[0]!.years).toBe(1);
  });

  it("keeps a 29 February start on the 28th in a year without one", async () => {
    vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    edges.leap = employment({ start_date: "2016-02-29" });

    const [row] = (await call()).anniversaries;

    // Not 1 March: `Date.UTC(2026, 1, 29)` rolls forward, which would name a
    // day the post did not begin on.
    expect(row!.date).toBe("2026-02-28");
    expect(row!.years).toBe(10);
  });

  it("leaves out a seat nobody is paid to sit on", async () => {
    // A rada społeczna seat is out of `experienceMonths` too, so counting it
    // here would print an anniversary of service the total says never
    // happened. The hospital's salaried director stays.
    edges.spoleczna = employment({ target: "szpital", name: "Rada Nadzorcza" });
    edges.dyrektor = employment({ target: "szpital", name: "Zarząd" });

    expect((await call()).anniversaries.map((a) => a.id)).toEqual(["dyrektor"]);
  });

  it("names a supervisory seat after the organ the institution has", async () => {
    edges.e1 = employment({ target: "orlen", name: "Rada Nadzorcza" });
    nodes.orlen!.supervisoryBody = "rada-nadzorcza";

    expect((await call()).anniversaries[0]!.role).toBe("Rada Nadzorcza");
  });

  it("leaves out anything but a known public institution", async () => {
    edges.prywatna = employment({ target: "prywatna" });
    edges.nieznana = employment({ target: "nieznana" });
    edges.publiczna = employment();

    expect((await call()).anniversaries.map((a) => a.id)).toEqual([
      "publiczna",
    ]);
  });

  it("leaves out a relation whose person or company is still a draft", async () => {
    edges.draftPerson = employment({ source: "draftPerson" });
    edges.draftCompany = employment({ target: "draftCompany" });
    edges.unpublishedEdge = employment({ published: false });
    edges.removed = employment({ deleted: true });

    expect((await call()).anniversaries).toEqual([]);
  });

  it("leaves out an edge that does not run from a person to a place", async () => {
    edges.backwards = employment({ source: "orlen", target: "anna" });
    edges.dangling = employment({ target: "nie-ma-takiego" });

    expect((await call()).anniversaries).toEqual([]);
  });

  it("says nothing about a role nobody recorded", async () => {
    edges.e1 = employment();

    expect((await call()).anniversaries[0]!.role).toBeNull();
  });

  it("reads a post that has ended as over", async () => {
    edges.e1 = employment({ end_date: "2020-01-01" });

    expect((await call()).anniversaries[0]!.ongoing).toBe(false);
  });

  it("skips a start date written as an explicit null", async () => {
    // /api/edges/create writes one for a blank field, and null is a value the
    // index sorts rather than one it drops - so unlike an absent date it does
    // come back, sorting last.
    edges.blank = { ...employment(), start_date: null };
    edges.dated = employment();

    expect((await call()).anniversaries.map((a) => a.id)).toEqual(["dated"]);
  });

  it("pages by offset without repeating or skipping", async () => {
    for (let i = 0; i < 5; i++) {
      edges[`e${i}`] = employment({ start_date: `200${i}-09-0${i + 1}` });
    }
    request({ limit: 2 });

    const first = await call();
    expect(first.total).toBe(5);
    expect(first.anniversaries).toHaveLength(2);
    expect(first.nextOffset).toBe(2);

    request({ limit: 2, offset: 2 });
    const second = await call();
    expect(second.nextOffset).toBe(4);

    request({ limit: 2, offset: 4 });
    const third = await call();
    expect(third.anniversaries).toHaveLength(1);
    expect(third.nextOffset).toBeNull();

    expect(
      [
        ...first.anniversaries,
        ...second.anniversaries,
        ...third.anniversaries,
      ].map((a) => a.id),
    ).toEqual(["e0", "e1", "e2", "e3", "e4"]);
  });

  it("counts the whole window, not the page on screen", async () => {
    // The page prints „w tym N jeszcze przed nami”, and counted off the loaded
    // cards that would read 0 until somebody had scrolled past today.
    edges.past = employment({ start_date: "2010-08-20" });
    edges.todays = employment({ start_date: "2016-09-09" });
    edges.soon = employment({ start_date: "2001-10-01" });
    request({ limit: 1 });

    const { total, upcoming, anniversaries } = await call();

    expect(anniversaries).toHaveLength(1);
    expect(total).toBe(3);
    // Today's counts as still to come - it is happening now.
    expect(upcoming).toBe(2);
  });

  it("asks Warsaw what day it is, not the server", async () => {
    // App Hosting runs in UTC, so between midnight and 02:00 Warsaw time a UTC
    // date is still yesterday and the page would show the wrong day's list for
    // the first two hours of it.
    vi.setSystemTime(new Date("2026-09-09T22:30:00Z"));

    expect((await call()).today).toBe("2026-09-10");
  });

  it("refuses a page size the feed was not designed to serve", async () => {
    request({ limit: 500 });

    await expect(call()).rejects.toMatchObject({ statusCode: 400 });
  });
});
