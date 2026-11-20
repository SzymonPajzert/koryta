import { describe, it, expect, vi, beforeEach } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  addDeclarationLink,
  draftPerson,
  linkId,
  LINKS_PER_DAY,
  personDeclarationCrops,
} from "../../../server/utils/declarationPersonCrops";

const { paid } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  return { paid: new Set<string>() };
});

// A Timestamp that keeps its date, as the stored links' `createdAt` is.
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    constructor(private readonly date: Date) {}
    static fromDate(date: Date) {
      return new Timestamp(date);
    }
    toDate() {
      return this.date;
    }
  }
  return { Timestamp };
});

// Which pages have a paid public post, which tests/server/utils/publicPosts.test.ts
// runs against the graph.
vi.mock("../../../server/utils/publicPosts", () => ({
  pagesWithAPublicPost: vi.fn(
    async (_db: unknown, ids: readonly string[]) =>
      new Set(ids.filter((id) => paid.has(id))),
  ),
}));

type Doc = Record<string, unknown>;
const tables = new Map<string, Record<string, Doc>>();
function table(name: string): Record<string, Doc> {
  if (!tables.has(name)) tables.set(name, {});
  return tables.get(name)!;
}
const queries: { collection: string; where: [string, string, unknown][] }[] =
  [];

const snapshot = (id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => data?.[field],
});

/** A query of equalities and `array-contains`, what the helper asks. */
function query(name: string, where: [string, string, unknown][]) {
  const matching = () =>
    Object.entries(table(name)).filter(([, data]) =>
      where.every(([field, op, value]) =>
        op === "array-contains"
          ? (data[field] as unknown[] | undefined)?.includes(value)
          : data[field] === value,
      ),
    );
  return {
    where: (field: string, op: string, value: unknown) =>
      query(name, [...where, [field, op, value]]),
    get: async () => {
      queries.push({ collection: name, where });
      return {
        docs: matching().map(([id, data]) => snapshot(id, data)),
      };
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: matching().length }) }),
    }),
  };
}

const db = {
  collection: (name: string) => ({
    ...query(name, []),
    doc: (id: string) => ({
      collection: name,
      id,
      get: async () => snapshot(id, table(name)[id]),
    }),
  }),
  getAll: async (...refs: unknown[]) =>
    (refs as { collection?: string; id?: string }[])
      .filter((ref) => ref.collection)
      .map((ref) => snapshot(ref.id!, table(ref.collection!)[ref.id!])),
  runTransaction: async (
    run: (tx: {
      get: (ref: { collection: string; id: string }) => Promise<unknown>;
      create: (ref: { collection: string; id: string }, data: Doc) => void;
    }) => Promise<unknown>,
  ) =>
    run({
      get: async (ref) => snapshot(ref.id, table(ref.collection)[ref.id]),
      create: (ref, data) => {
        table(ref.collection)[ref.id] = data;
      },
    }),
} as unknown as Firestore;

const STRZELIN = "Strzelin (gmina miejsko-wiejska)";

/** A crop of Kowalska's declaration, still waiting for readers unless told
 * otherwise. */
function crop(fields: Doc = {}): Doc {
  return {
    status: "open",
    personIds: ["kowalska"],
    url: "https://bip.strzelin.pl/download/1",
    units: [{ unitName: STRZELIN, office: "Rada gminy", teryt: "021502" }],
    answerCount: 0,
    agreed: null,
    failure: null,
    imageSize: {
      date: { width: 942, height: 93 },
      name: { width: 1128, height: 70 },
    },
    ...fields,
  };
}

/** Kowalska's won candidacy for Strzelin's council in `year`, as the crawler
 * stored it. */
function candidacy(fields: Doc = {}): Doc {
  return {
    personIds: ["kowalska"],
    teryt: "021503",
    unitName: STRZELIN,
    level: "gmina",
    office: "Rada gminy",
    year: 2018,
    status: "not_found",
    reason: "not_listed",
    bipUrls: ["https://bip.strzelin.pl/"],
    files: 0,
    ...fields,
  };
}

/** A candidacy on Kowalska's page, filed under the powiat as the page files
 * a gmina's. */
function election(fields: Doc = {}): Doc {
  return {
    source: "kowalska",
    target: "teryt0215",
    type: "election",
    position: "Rada gminy",
    start_date: "2018-01-01",
    elected: true,
    ...fields,
  };
}

beforeEach(() => {
  tables.clear();
  queries.length = 0;
  paid.clear();
  table("nodes").teryt0215 = { type: "region", name: "powiat strzeliński" };
});

describe("personDeclarationCrops", () => {
  it("lists the page's crops by its own id", async () => {
    Object.assign(table("declarationExtracts"), {
      "a-p0": crop({ answerCount: 1 }),
      // Somebody else's: never listed.
      "b-p0": crop({ personIds: ["nowak"] }),
    });

    expect(await personDeclarationCrops(db, "kowalska", "reader")).toEqual({
      publication: null,
      crops: [
        {
          id: "a-p0",
          status: "open",
          failure: null,
          unit: STRZELIN,
          office: "Rada gminy",
          documentUrl: "https://bip.strzelin.pl/download/1",
          answers: 1,
          agreed: null,
          agreedBy: null,
          outcome: null,
          imageSize: {
            date: { width: 942, height: 93 },
            name: { width: 1128, height: 70 },
          },
        },
      ],
      searches: [],
      links: [],
    });
    expect(queries).toEqual([
      {
        collection: "declarationExtracts",
        where: [["personIds", "array-contains", "kowalska"]],
      },
    ]);
  });

  it("orders the crops by what they say, nothing cut last, and leaves out those taken back", async () => {
    Object.assign(table("declarationExtracts"), {
      "open-p0": crop(),
      "busier-p0": crop({ answerCount: 1 }),
      "failed-p0": crop({
        status: "failed",
        failure: "no_label",
        imageSize: undefined,
      }),
      "withdrawn-p0": crop({ status: "withdrawn" }),
      "other-p0": crop({
        status: "agreed",
        agreed: { value: "1978-02-01", kind: "date", by: "readers" },
        pageOutcomes: { kowalska: "different" },
      }),
      "matched-p0": crop({
        status: "agreed",
        agreed: { value: "1979-07-15", kind: "date", by: "machine" },
        pageOutcomes: { kowalska: "queued", nowak: "different" },
      }),
    });

    const { crops, searches } = await personDeclarationCrops(
      db,
      "kowalska",
      "reader",
    );
    expect(crops.map((c) => c.id)).toEqual([
      "matched-p0",
      "other-p0",
      "busier-p0",
      "open-p0",
      "failed-p0",
    ]);
    // What the reading said about this page, not about another one's.
    expect(crops[0]).toMatchObject({
      agreed: "1979-07-15",
      agreedBy: "machine",
      outcome: "queued",
    });
    expect(crops[4]).toMatchObject({ failure: "no_label", imageSize: null });
    // A page with a crop asks nothing about elections.
    expect(searches).toEqual([]);
    expect(queries.map((q) => q.collection)).toEqual(["declarationExtracts"]);
  });

  it("never takes an unknown code for one of the site's", async () => {
    table("declarationExtracts")["read-p0"] = crop({
      status: "agreed",
      imageSize: undefined,
      agreed: { value: "1979-07-15", kind: "date", by: "someone" },
      pageOutcomes: { kowalska: "maybe" },
    });

    const [read] = (await personDeclarationCrops(db, "kowalska", "reader"))
      .crops;
    expect(read).toMatchObject({
      imageSize: null,
      agreedBy: null,
      outcome: null,
    });
  });

  it("gives a held page's record with whether a paid post is on the page now", async () => {
    table("declarationExtracts")["a-p0"] = crop();
    table("declarationPublications").kowalska = {
      status: "held",
      reason: "no_public_post",
    };
    paid.add("kowalska");

    expect(
      (await personDeclarationCrops(db, "kowalska", "reader")).publication,
    ).toEqual({ status: "held", reason: "no_public_post", paidPost: true });
  });

  it("tells a declined page from a held one, and reads no posts for a queued one", async () => {
    table("declarationExtracts")["a-p0"] = crop();
    const publications = table("declarationPublications");
    publications.kowalska = {
      status: "held",
      reason: "two_places",
      declinedAt: new Date(),
    };
    expect(
      (await personDeclarationCrops(db, "kowalska", "reader")).publication,
    ).toEqual({ status: "declined", reason: "two_places", paidPost: false });

    publications.kowalska = { status: "queued", reason: null };
    paid.add("kowalska");
    expect(
      (await personDeclarationCrops(db, "kowalska", "reader")).publication,
    ).toEqual({ status: "queued", reason: null, paidPost: false });
  });

  it("gives no record of a publication that went through", async () => {
    table("declarationExtracts")["a-p0"] = crop();
    for (const status of ["published", "confirmed"]) {
      table("declarationPublications").kowalska = { status, reason: null };
      expect(
        (await personDeclarationCrops(db, "kowalska", "reader")).publication,
      ).toBeNull();
    }
  });
});

describe("personDeclarationCrops with no crop", () => {
  it("lists each election won since 2014 with what the crawler found, newest first", async () => {
    Object.assign(table("declarationCandidacies"), {
      c2018: candidacy(),
      c2024: candidacy({
        year: 2024,
        status: "unconfirmed",
        reason: "unnamed",
        files: 3,
        bipUrls: [],
      }),
      // Somebody else's.
      other: candidacy({ personIds: ["nowak"], year: 2024, office: "Wójt" }),
    });
    Object.assign(table("edges"), {
      e2018: election(),
      e2024: election({ start_date: "2024-01-01" }),
    });

    const { crops, searches } = await personDeclarationCrops(
      db,
      "kowalska",
      "reader",
    );
    expect(crops).toEqual([]);
    expect(searches).toEqual([
      {
        year: 2024,
        office: "Rada gminy",
        unit: STRZELIN,
        status: "unconfirmed",
        reason: "unnamed",
        files: 3,
        bipUrl: null,
      },
      {
        year: 2018,
        office: "Rada gminy",
        unit: STRZELIN,
        status: "not_found",
        reason: "not_listed",
        files: 0,
        bipUrl: "https://bip.strzelin.pl/",
      },
    ]);
    expect(queries.slice(1)).toEqual(
      expect.arrayContaining([
        {
          collection: "declarationCandidacies",
          where: [["personIds", "array-contains", "kowalska"]],
        },
        {
          collection: "edges",
          where: [
            ["source", "==", "kowalska"],
            ["type", "==", "election"],
          ],
        },
      ]),
    );
  });

  it("names a win the crawler never looked for after the region the page files it under", async () => {
    table("declarationCandidacies").c2018 = candidacy();
    Object.assign(table("edges"), {
      e2018: election(),
      wojt: election({ position: "Wójt", start_date: "2024-01-01" }),
    });

    expect(
      (await personDeclarationCrops(db, "kowalska", "reader")).searches,
    ).toEqual([
      {
        year: 2024,
        office: "Wójt",
        unit: "powiat strzeliński",
        status: null,
        reason: null,
        files: 0,
        bipUrl: null,
      },
      expect.objectContaining({ year: 2018, status: "not_found" }),
    ]);
  });

  it("leaves out what has no BIP declaration to find: lost, older, parliamentary, deleted", async () => {
    Object.assign(table("edges"), {
      lost: election({ elected: undefined }),
      old: election({ start_date: "2010-01-01" }),
      sejm: election({ position: "Sejm", target: "teryt02" }),
      gone: election({ deleted: true }),
    });
    table("declarationCandidacies").old = candidacy({ year: 2010 });

    const answer = await personDeclarationCrops(db, "kowalska", "reader");
    expect(answer.searches).toEqual([]);
  });

  it("lists a candidacy the crawler searched even with no win on the page", async () => {
    table("declarationCandidacies").c2018 = candidacy();

    expect(
      (await personDeclarationCrops(db, "kowalska", "reader")).searches,
    ).toEqual([expect.objectContaining({ year: 2018, unit: STRZELIN })]);
  });

  it("keeps a sejmik win apart from a council one, matched by the województwo's digits", async () => {
    table("declarationCandidacies").sejmik = candidacy({
      office: "Sejmik",
      teryt: "020000",
      unitName: "województwo dolnośląskie",
      year: 2024,
    });
    Object.assign(table("edges"), {
      sejmik: election({
        position: "Sejmik",
        target: "teryt02",
        start_date: "2024-01-01",
      }),
      rada: election({ start_date: "2024-01-01" }),
    });

    const { searches } = await personDeclarationCrops(db, "kowalska", "reader");
    expect(searches.map((s) => [s.office, s.unit, s.status])).toEqual([
      ["Sejmik", "województwo dolnośląskie", "not_found"],
      ["Rada gminy", "powiat strzeliński", null],
    ]);
  });
});

vi.mock("../../../server/utils/merge", () => ({
  resolveMergedNode: async (_db: unknown, id: string) => {
    const merged = id === "kowalska-old" ? "kowalska" : id;
    const data = table("nodes")[merged];
    return {
      id: merged,
      snapshot: data ? { data: () => data } : undefined,
    };
  },
}));

describe("draftPerson", () => {
  it("follows a merge to the draft it went into", async () => {
    table("nodes").kowalska = { type: "person", published: false };
    expect(await draftPerson(db, "kowalska-old")).toBe("kowalska");
  });

  it("is a 404 for a public page, a page that is gone, and one no person's", async () => {
    const nodes = table("nodes");
    nodes.kowalska = { type: "person", published: true };
    nodes.strzelin = { type: "place", published: false };
    for (const id of ["kowalska", "nobody", "strzelin"]) {
      await expect(draftPerson(db, id)).rejects.toMatchObject({
        statusCode: 404,
      });
    }
  });
});

describe("declaration links", () => {
  const URL = "https://bip.strzelin.pl/rada/oswiadczenia/kowalska.pdf";

  it("lists the page's links with no crop, the oldest first, marking the reader's own", async () => {
    Object.assign(table("declarationLinks"), {
      [linkId("kowalska", URL)]: {
        personId: "kowalska",
        url: URL,
        uid: "reader",
        createdAt: Timestamp.fromDate(new Date("2026-11-20T10:00:00Z")),
      },
      older: {
        personId: "kowalska",
        url: "https://bip.strzelin.pl/rada",
        uid: "someone",
        createdAt: Timestamp.fromDate(new Date("2026-11-19T10:00:00Z")),
      },
      nowak: { personId: "nowak", url: URL, uid: "reader" },
    });

    expect(
      (await personDeclarationCrops(db, "kowalska", "reader")).links,
    ).toEqual([
      {
        url: "https://bip.strzelin.pl/rada",
        at: "2026-11-19T10:00:00.000Z",
        mine: false,
      },
      { url: URL, at: "2026-11-20T10:00:00.000Z", mine: true },
    ]);
  });

  it("reads no links for a page with a crop", async () => {
    table("declarationExtracts")["a-p0"] = crop();
    table("declarationLinks").x = { personId: "kowalska", url: URL, uid: "r" };
    expect(
      (await personDeclarationCrops(db, "kowalska", "reader")).links,
    ).toEqual([]);
  });

  it("stores a link once a page and address, whoever gives it again", async () => {
    const now = new Date("2026-11-20T10:00:00Z");
    expect(
      await addDeclarationLink(db, {
        personId: "kowalska",
        url: URL,
        uid: "reader",
        now,
      }),
    ).toBe("added");
    expect(table("declarationLinks")[linkId("kowalska", URL)]).toEqual({
      personId: "kowalska",
      url: URL,
      host: "bip.strzelin.pl",
      uid: "reader",
      day: "2026-11-20",
      status: "new",
      createdAt: Timestamp.fromDate(now),
    });
    expect(
      await addDeclarationLink(db, {
        personId: "kowalska",
        url: URL,
        uid: "other",
        now,
      }),
    ).toBe("known");
    expect(table("declarationLinks")[linkId("kowalska", URL)]?.uid).toBe(
      "reader",
    );
    // Another page's link to the same file is that page's.
    expect(linkId("nowak", URL)).not.toBe(linkId("kowalska", URL));
  });

  it("refuses a reader's links past the day's limit, in the Warsaw day", async () => {
    const links = table("declarationLinks");
    for (let i = 0; i < LINKS_PER_DAY; i++) {
      links[`l${i}`] = { personId: `p${i}`, uid: "reader", day: "2026-11-20" };
    }
    await expect(
      addDeclarationLink(db, {
        personId: "kowalska",
        url: URL,
        uid: "reader",
        now: new Date("2026-11-20T10:00:00Z"),
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    // 23:30 UTC is the next day in Warsaw.
    expect(
      await addDeclarationLink(db, {
        personId: "kowalska",
        url: URL,
        uid: "reader",
        now: new Date("2026-11-20T23:30:00Z"),
      }),
    ).toBe("added");
    // Somebody else's day is their own.
    expect(
      await addDeclarationLink(db, {
        personId: "kowalska",
        url: `${URL}?2`,
        uid: "other",
        now: new Date("2026-11-20T10:00:00Z"),
      }),
    ).toBe("added");
  });
});
