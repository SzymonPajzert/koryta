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
  getAll: async (...refs: { path: string }[]) =>
    refs.map((r) => snapshot(r.path)),
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
        agreed: { value: "1980-01-01", at: at("2026-10-28T09:00:00Z") },
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
    expect(overview.publications).toMatchObject({
      held: 1,
      today: 3,
      heldBy: [{ reason: "pending_proposal", count: 1 }],
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
    expect(lists.different[0]).toMatchObject({
      id: "x2",
      unit: "TERYT 021704",
      agreed: "1980-01-01",
    });
    expect(lists.held).toEqual([
      expect.objectContaining({
        personId: "kowalska",
        name: "Anna Kowalska",
        reason: "pending_proposal",
        unit: "Strzelin",
      }),
    ]);
    expect(runs.map((run) => [run.runId, run.extracts])).toEqual([
      ["run-1", 2],
      ["run-0", 1],
    ]);
  });
});
