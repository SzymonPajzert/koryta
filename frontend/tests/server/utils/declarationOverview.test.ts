import { describe, it, expect, vi, beforeEach } from "vitest";
import { countEverything } from "../../../server/utils/declarationOverview";

/** A Timestamp double good enough for ranges and `toDate`. */
const { FakeTimestamp } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(readonly date: Date) {}
    toDate() {
      return this.date;
    }
    static fromDate(date: Date) {
      return new FakeTimestamp(date);
    }
  }
  return { FakeTimestamp };
});
vi.mock("firebase-admin/firestore", () => ({ Timestamp: FakeTimestamp }));

type Data = Record<string, unknown>;
let stored: Map<string, Data>;

function read(data: Data | undefined, field: string): unknown {
  return field
    .split(".")
    .reduce<unknown>((value, key) => (value as Data | undefined)?.[key], data);
}

function snapshot(path: string) {
  const data = stored.get(path);
  return {
    id: path.slice(path.indexOf("/") + 1),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => read(data, field),
  };
}

type Filter = [string, string, unknown];
type Query = {
  collection: string;
  filters: Filter[];
  orders: [string, string][];
  max?: number;
};

const value = (v: unknown) =>
  v instanceof FakeTimestamp ? v.date.getTime() : v;

function run(q: Query) {
  const docs = [...stored.keys()]
    .filter((path) => path.startsWith(`${q.collection}/`))
    .map(snapshot)
    .filter((doc) =>
      q.filters.every(([field, op, expected]) => {
        const actual = value(doc.get(field)) as number | undefined;
        if (op === ">=")
          return actual !== undefined && actual >= (value(expected) as number);
        if (op === "in")
          return (expected as unknown[]).includes(doc.get(field));
        return doc.get(field) === expected;
      }),
    );
  for (const [field, dir] of [...q.orders].reverse()) {
    docs.sort((a, b) => {
      const x = String(value(a.get(field)) ?? "");
      const y = String(value(b.get(field)) ?? "");
      return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1);
    });
  }
  return q.max === undefined ? docs : docs.slice(0, q.max);
}

function query(q: Query): Record<string, unknown> {
  return {
    where: (field: string, op: string, v: unknown) =>
      query({ ...q, filters: [...q.filters, [field, op, v]] }),
    orderBy: (field: string, dir = "asc") =>
      query({ ...q, orders: [...q.orders, [field, dir]] }),
    select: () => query(q),
    limit: (max: number) => query({ ...q, max }),
    get: async () => ({ docs: run(q) }),
    count: () => ({
      get: async () => ({ data: () => ({ count: run(q).length }) }),
    }),
  };
}

const db = {
  collection: (collection: string) => ({
    ...query({ collection, filters: [], orders: [] }),
    doc: (id: string) => ({
      path: `${collection}/${id}`,
      get: async () => snapshot(`${collection}/${id}`),
    }),
  }),
  // A read options object (`fieldMask`) may come last, after the refs.
  getAll: async (...args: ({ path: string } | { fieldMask?: string[] })[]) =>
    args
      .filter((arg): arg is { path: string } => "path" in arg)
      .map((r) => snapshot(r.path)),
};

const NOW = new Date("2026-10-29T12:00:00Z");
const at = (iso: string) => FakeTimestamp.fromDate(new Date(iso));

beforeEach(() => {
  stored = new Map<string, Data>([
    ["declarationCandidacies/a", { status: "found", personIds: ["kowalska"] }],
    ["declarationCandidacies/b", { status: "found", personIds: ["kowalska"] }],
    [
      "declarationCandidacies/c",
      { status: "not_found", reason: "no_seed", personIds: ["nowak"] },
    ],
    [
      "declarationCandidacies/d",
      { status: "not_found", reason: "brand_new_code", personIds: ["nowak"] },
    ],
    [
      "declarationExtracts/x1",
      {
        status: "disputed",
        units: [{ unitName: "Strzelin", office: "Rada gminy" }],
        url: "https://bip.strzelin.pl/1",
        personIds: ["kowalska"],
        answers: {
          readings: { "1979-07-15": 2, "1979-07-16": 2 },
          unreadable: 1,
          empty: 1,
        },
        updatedAt: at("2026-10-29T10:00:00Z"),
        tag: "bip-cut-v1",
        runId: "run-1",
      },
    ],
    [
      "declarationExtracts/x2",
      {
        status: "agreed",
        pageMatch: "different",
        agreed: {
          value: "1980-01-01",
          kind: "date",
          by: "admin",
          at: at("2026-10-28T09:00:00Z"),
        },
        personIds: ["nowak"],
        units: [{ teryt: "021704", office: "Rada gminy" }],
        url: "https://bip.strzelin.pl/2",
        updatedAt: at("2026-10-28T09:00:00Z"),
        tag: "bip-cut-v1",
        runId: "run-1",
      },
    ],
    [
      "declarationExtracts/x3",
      {
        status: "failed",
        reason: "blank_form",
        updatedAt: at("2026-10-27T09:00:00Z"),
        tag: "bip-cut-v1",
        runId: "run-0",
      },
    ],
    [
      "declarationAnswers/x1_r1",
      {
        uid: "r1",
        counted: true,
        votes: true,
        day: "2026-10-29",
        at: at("2026-10-29T09:00:00Z"),
      },
    ],
    [
      "declarationAnswers/x1_r2",
      {
        uid: "r2",
        counted: true,
        votes: true,
        day: "2026-10-29",
        at: at("2026-10-29T09:30:00Z"),
      },
    ],
    [
      // Read without an account: no vote, so no reader and no answer here.
      "declarationAnswers/x1_anon:0f8fad5b-d9cb-469f-a165-000000000001",
      {
        uid: "anon:0f8fad5b-d9cb-469f-a165-000000000001",
        counted: true,
        votes: false,
        day: "2026-10-29",
        at: at("2026-10-29T10:30:00Z"),
      },
    ],
    [
      "declarationAnswers/x2_r1",
      {
        uid: "r1",
        counted: false,
        votes: true,
        day: "2026-10-28",
        at: at("2026-10-28T08:00:00Z"),
      },
    ],
    [
      "declarationPublications/kowalska",
      {
        status: "held",
        reason: "pending_proposal",
        queuedAt: at("2026-10-29T08:00:00Z"),
        declarations: [{ url: "https://bip.strzelin.pl/1", unit: "Strzelin" }],
      },
    ],
    ["declarationPublishLimits/2026-10-29", { count: 3 }],
    [
      "nodes/kowalska",
      {
        type: "person",
        name: "Anna Kowalska",
        published: false,
        birthDate: "1979-07-15",
      },
    ],
    [
      "nodes/nowak",
      {
        type: "person",
        name: "Jan Nowak",
        published: true,
        birthDate: "1979-07-15",
      },
    ],
  ]);
});

describe("countEverything", () => {
  it("counts the searches, the crops, the readers who vote and the publications", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overview = await countEverything(db as any, 10, NOW);

    expect(overview.dailyLimit).toBe(10);
    expect(overview.candidacies).toEqual({
      total: 4,
      people: 2,
      byStatus: { pending: 0, found: 2, unconfirmed: 0, not_found: 2 },
      notFound: [
        { reason: "no_seed", count: 1 },
        { reason: "other", count: 1 },
      ],
    });
    expect(overview.extracts.byStatus).toMatchObject({
      disputed: 1,
      agreed: 1,
      failed: 1,
      open: 0,
    });
    expect(overview.extracts.failed).toEqual([
      { reason: "blank_form", count: 1 },
    ]);
    expect(overview.readers.answers).toBe(2);
    expect(overview.readers.readers).toBe(2);
    expect(overview.readers.days).toHaveLength(30);
    expect(overview.readers.days.at(-1)).toEqual({
      day: "2026-10-29",
      answers: 2,
      settled: 0,
    });
    expect(overview.readers.days.at(-2)).toEqual({
      day: "2026-10-28",
      answers: 0,
      settled: 1,
    });
    expect(overview.pages).toEqual({
      same: 0,
      different: 1,
      noDate: 0,
      confirmed: 0,
    });
    // Her page has no post on it, so nobody is asked about her proposal.
    expect(overview.publications).toMatchObject({
      held: 0,
      setAside: 1,
      today: 3,
      heldBy: [],
    });
  });

  describe("who waits for an admin, and who will not be published", () => {
    const hold = (id: string, reason: string, day: number, fields: Data = {}) =>
      stored.set(`declarationPublications/${id}`, {
        status: "held",
        reason,
        queuedAt: at(`2026-10-${String(day).padStart(2, "0")}T10:00:00Z`),
        heldAt: at(`2026-10-${String(day).padStart(2, "0")}T10:00:00Z`),
        declarations: [],
        ...fields,
      });

    /** A paid post on the page, at the water company of the world below. */
    const post = (id: string) =>
      stored.set(`edges/${id}-job`, {
        type: "employed",
        name: "Zarząd",
        source: id,
        target: "wodociagi",
      });

    beforeEach(() => {
      stored.set("nodes/wodociagi", { type: "place", isPublic: true });
      post("kowalska");
    });

    it("reads what becomes of a page off the page, not off why it was held", async () => {
      // Held for something else, and with no post either: the record's first
      // reason says nothing about the ones after it.
      hold("no-post", "two_places", 3);
      hold("ruled-out", "no_public_post", 4);
      // Declined: still held on the record, with the admin's no on it.
      hold("declined", "two_places", 2, {
        declinedBy: "admin",
        declinedAt: at("2026-10-27T10:00:00Z"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { publications, lists } = await countEverything(db as any, 0, NOW);

      expect(publications).toMatchObject({
        held: 1,
        setAside: 3,
        heldBy: [{ reason: "pending_proposal", count: 1 }],
      });
      expect(lists.held.map((row) => row.personId)).toEqual(["kowalska"]);
      // The newest first, an admin's by when they said no.
      expect(
        lists.setAside.map((row) => [row.personId, row.status, row.reason]),
      ).toEqual([
        ["declined", "declined", "two_places"],
        ["ruled-out", "held", "no_public_post"],
        ["no-post", "held", "two_places"],
      ]);
      expect(lists.setAside[0]!.at).toBe("2026-10-27T10:00:00.000Z");
    });

    it("brings a page back the day it has a post, whatever it was held for", async () => {
      hold("gained", "no_public_post", 3);
      post("gained");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { publications, lists } = await countEverything(db as any, 0, NOW);

      expect(lists.held.map((row) => row.personId)).toContain("gained");
      expect(publications.setAside).toBe(0);
      expect(lists.held.find((row) => row.personId === "gained")).toMatchObject(
        { reason: "no_public_post", paidPost: true },
      );
    });

    it("does not count an unpaid seat, or a job at a company nobody owns", async () => {
      stored.set("nodes/szpital", {
        type: "place",
        isPublic: true,
        supervisoryBody: "rada-spoleczna",
      });
      stored.set("nodes/prywatna", { type: "place", isPublic: false });
      hold("seat", "two_places", 3);
      stored.set("edges/seat-job", {
        type: "employed",
        name: "Rada Nadzorcza",
        source: "seat",
        target: "szpital",
      });
      hold("private", "two_places", 4);
      stored.set("edges/private-job", {
        type: "employed",
        name: "Zarząd",
        source: "private",
        target: "prywatna",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { lists } = await countEverything(db as any, 0, NOW);

      expect(lists.setAside.map((row) => row.personId).sort()).toEqual([
        "private",
        "seat",
      ]);
    });

    it("leaves a public page on the list, with its hold to close", async () => {
      stored.set("nodes/up", { name: "Up", published: true });
      hold("up", "two_places", 3);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { lists } = await countEverything(db as any, 0, NOW);

      expect(lists.held.find((row) => row.personId === "up")).toMatchObject({
        pagePublic: true,
        paidPost: false,
      });
    });

    it("lists every hold, the newest first, not the newest twenty", async () => {
      for (let day = 1; day <= 25; day++) {
        hold(
          `held-${day}`,
          day % 2 ? "two_places" : "ambiguous_candidacy",
          day,
        );
        post(`held-${day}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { publications, lists } = await countEverything(db as any, 0, NOW);

      expect(lists.held).toHaveLength(26);
      const days = lists.held.map((row) => row.at);
      expect(days).toEqual([...days].sort().reverse());
      // By how many they hold.
      expect(publications.heldBy).toEqual([
        { reason: "two_places", count: 13 },
        { reason: "ambiguous_candidacy", count: 12 },
        { reason: "pending_proposal", count: 1 },
      ]);
    });

    it("lists every hold, so none is counted where it is not shown", async () => {
      // Newer than everything that waits, and more than any cap would keep.
      for (let i = 0; i < 400; i++) {
        hold(`nopost-${i}`, "no_public_post", 28);
      }
      hold("old", "two_places", 1);
      post("old");
      // Past where a cap of 300 by id would have stopped, gaining a post.
      hold("zz-gained", "no_public_post", 27);
      post("zz-gained");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { publications, lists } = await countEverything(db as any, 0, NOW);

      expect(lists.held.map((row) => row.personId)).toEqual(
        expect.arrayContaining(["old", "zz-gained"]),
      );
      expect(publications.setAside).toBe(400);
      expect(lists.setAside).toHaveLength(400);
      expect(publications.held).toBe(lists.held.length);
    });

    it("keeps a page held again where it first waited", async () => {
      hold("first", "two_places", 5);
      post("first");
      // Waited before "first", held again by a recheck since.
      hold("rechecked", "conflicting_reading", 2, {
        heldAt: at("2026-10-28T10:00:00Z"),
      });
      post("rechecked");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { lists } = await countEverything(db as any, 0, NOW);

      const order = lists.held.map((row) => row.personId);
      expect(order.indexOf("first")).toBeLessThan(order.indexOf("rechecked"));
      // Shown by when it was held.
      expect(lists.held.find((row) => row.personId === "rechecked")!.at).toBe(
        "2026-10-28T10:00:00.000Z",
      );
    });

    it("leaves out the record of a page merged into another or removed", async () => {
      stored.set("nodes/merged", { name: "M", merged_into: "kowalska" });
      hold("merged", "two_pages", 3);
      stored.set("nodes/removed", { name: "R", deleted: true });
      hold("removed", "two_places", 4);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { lists } = await countEverything(db as any, 0, NOW);

      const listed = [...lists.held, ...lists.setAside].map((r) => r.personId);
      expect(listed).not.toContain("merged");
      expect(listed).not.toContain("removed");
    });

    it("says which publications an admin made by hand", async () => {
      stored.set("declarationPublications/by-hand", {
        status: "published",
        reason: null,
        autoPublished: false,
        publishedAt: at("2026-10-29T09:00:00Z"),
        handPublished: { uid: "admin", held: "two_places" },
        declarations: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { lists } = await countEverything(db as any, 0, NOW);

      expect(
        lists.recent.find((row) => row.personId === "by-hand"),
      ).toMatchObject({ status: "published", byHand: true });
    });
  });

  it("reads the newest answers first, so a month past the cap leaves the oldest days short, never today", async () => {
    // Stored first, as Firestore would hand them first by their time.
    const older: [string, Data][] = Array.from({ length: 20_000 }, (_, i) => [
      `declarationAnswers/old_anon:${i}`,
      {
        uid: `anon:${i}`,
        counted: true,
        votes: false,
        day: "2026-10-20",
        at: at("2026-10-20T09:00:00Z"),
      },
    ]);
    stored = new Map([...older, ...stored]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overview = await countEverything(db as any, 0, NOW);

    expect(overview.readers.days.at(-1)).toMatchObject({
      day: "2026-10-29",
      answers: 2,
    });
  });

  it("lists what an admin decides, with the readings and the pages' dates", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { lists, runs } = await countEverything(db as any, 0, NOW);

    expect(lists.disputed).toEqual([
      expect.objectContaining({
        id: "x1",
        unit: "Strzelin",
        readings: [
          { value: "1979-07-15", readers: 2 },
          { value: "1979-07-16", readers: 2 },
        ],
        unreadable: 2,
        agreed: null,
        agreedBy: null,
        people: [
          {
            id: "kowalska",
            name: "Anna Kowalska",
            published: false,
            birthDate: "1979-07-15",
          },
        ],
      }),
    ]);
    // Whose date it is, so the row does not take an admin's for the readers'.
    expect(lists.different[0]).toMatchObject({
      id: "x2",
      unit: "TERYT 021704",
      agreed: "1980-01-01",
      agreedBy: "admin",
    });
    expect(lists.setAside).toEqual([
      expect.objectContaining({
        personId: "kowalska",
        name: "Anna Kowalska",
        reason: "pending_proposal",
        pagePublic: false,
        paidPost: false,
        unit: "Strzelin",
      }),
    ]);
    expect(runs.map((run) => [run.runId, run.extracts])).toEqual([
      ["run-1", 2],
      ["run-0", 1],
    ]);
  });

  it("says whose a date is, readers' or the job's, and whether a held page is public by now", async () => {
    stored.set("declarationExtracts/x2", {
      ...stored.get("declarationExtracts/x2")!,
      agreed: { value: "1980-01-01", kind: "date", by: "machine" },
    });
    // Published by hand while it waited.
    stored.set("nodes/kowalska", {
      ...stored.get("nodes/kowalska")!,
      published: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { lists } = await countEverything(db as any, 0, NOW);

    expect(lists.different[0]).toMatchObject({ agreedBy: "machine" });
    expect(lists.held[0]).toMatchObject({
      personId: "kowalska",
      pagePublic: true,
    });

    stored.set("declarationExtracts/x2", {
      ...stored.get("declarationExtracts/x2")!,
      agreed: { value: "1980-01-01", kind: "date", by: "readers" },
    });
    const again = await countEverything(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      0,
      NOW,
    );
    expect(again.lists.different[0]).toMatchObject({ agreedBy: "readers" });
  });
});

// After an admin's press of „Opublikuj z kolejki”, which publishes past the
// automatic daily limit and in none of its places.
describe("countEverything, after an admin's press", () => {
  it("counts the page as published, not as today's, and says whose it is", async () => {
    stored.set("declarationPublications/nowak", {
      status: "published",
      pressedBy: "admin-uid",
      autoPublished: false,
      publishedAt: at("2026-10-29T11:00:00Z"),
      declarations: [{ url: "https://bip.strzelin.pl/3", unit: "Strzelin" }],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { publications, lists } = await countEverything(db as any, 10, NOW);

    expect(publications).toMatchObject({ published: 1, today: 3 });
    expect(lists.recent).toEqual([
      expect.objectContaining({ personId: "nowak", pressed: true }),
    ]);
    expect(lists.setAside).toEqual([
      expect.objectContaining({ personId: "kowalska", pressed: false }),
    ]);
  });
});
