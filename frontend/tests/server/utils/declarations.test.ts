import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  isCountedReader,
  queueFor,
  recordAnswer,
  READER_DAILY_LIMIT,
} from "../../../server/utils/declarations";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
});

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { fromDate: (date: Date) => ({ iso: date.toISOString() }) },
}));

/**
 * A Firestore double that runs queries for real over an in-memory map:
 * equality filters, ordering on several fields, a cursor, limits, count(),
 * getAll, and transactions whose writes land only when the function returns.
 */
type Data = Record<string, unknown>;
let stored: Map<string, Data>;

function snapshot(path: string) {
  const data = stored.get(path);
  const id = path.slice(path.indexOf("/") + 1);
  return {
    id,
    ref: { path },
    exists: data !== undefined,
    data: () => (data ? structuredClone(data) : undefined),
    get: (field: string) => data?.[field],
  };
}

type Query = {
  collection: string;
  filters: [string, unknown][];
  orders: [string, "asc" | "desc"][];
  max?: number;
  after?: { id: string };
};

function run(query: Query) {
  let docs = [...stored.keys()]
    .filter((path) => path.startsWith(`${query.collection}/`))
    .map(snapshot)
    .filter((doc) =>
      query.filters.every(([field, value]) => doc.get(field) === value),
    );
  docs.sort((a, b) => {
    for (const [field, dir] of query.orders) {
      const x = a.get(field) as number;
      const y = b.get(field) as number;
      if (x !== y) return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
    }
    return 0;
  });
  if (query.after) {
    docs = docs.slice(docs.findIndex((d) => d.id === query.after!.id) + 1);
  }
  if (query.max !== undefined) docs = docs.slice(0, query.max);
  return docs;
}

function queryOf(base: Query) {
  const make = (q: Query): Record<string, unknown> => ({
    __query: q,
    where: (field: string, _op: string, value: unknown) =>
      make({ ...q, filters: [...q.filters, [field, value]] }),
    orderBy: (field: string, dir: "asc" | "desc" = "asc") =>
      make({ ...q, orders: [...q.orders, [field, dir]] }),
    limit: (max: number) => make({ ...q, max }),
    startAfter: (doc: { id: string }) => make({ ...q, after: doc }),
    get: async () => {
      const docs = run(q);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: run(q).length }) }),
    }),
  });
  return make(base);
}

const db = {
  collection: (collection: string) => ({
    ...queryOf({ collection, filters: [], orders: [] }),
    doc: (id: string) => ({ path: `${collection}/${id}`, id }),
  }),
  getAll: async (...refs: { path: string }[]) =>
    refs.map((ref) => snapshot(ref.path)),
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const writes: (() => void)[] = [];
    const tx = {
      get: async (target: { path?: string; __query?: Query }) => {
        if (target.__query) {
          const docs = run(target.__query);
          return { docs, empty: docs.length === 0 };
        }
        return snapshot(target.path!);
      },
      set: (ref: { path: string }, data: Data, options?: { merge?: boolean }) =>
        writes.push(() =>
          stored.set(ref.path, {
            ...(options?.merge ? (stored.get(ref.path) ?? {}) : {}),
            ...data,
          }),
        ),
      update: (ref: { path: string }, data: Data) =>
        writes.push(() =>
          stored.set(ref.path, { ...stored.get(ref.path)!, ...data }),
        ),
    };
    const result = await fn(tx);
    for (const write of writes) write();
    return result;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firestore = db as any;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function crop(id: string, fields: Data = {}) {
  stored.set(`declarationExtracts/${id}`, {
    status: "open",
    priority: 0,
    answerCount: 0,
    rand: 0.5,
    url: `https://bip.example.pl/${id}.pdf`,
    host: "bip.example.pl",
    declarationYear: 2023,
    units: [{ teryt: "021704", unitName: "Strzelin", office: "Rada gminy" }],
    imageHash: "hash",
    imageSize: { date: { width: 951, height: 105 }, name: null },
    personIds: ["kowalska"],
    ...fields,
  });
  stored.set(`declarationExtractImages/${id}`, { date: PNG, name: null });
}

function reader(uid: string, fields: Partial<DecodedIdToken> = {}) {
  return {
    uid,
    email_verified: true,
    firebase: { sign_in_provider: "password" },
    ...fields,
  } as unknown as DecodedIdToken;
}

const answer = (uid: string, value: string, extractId = "c1") =>
  recordAnswer(firestore, {
    extractId,
    user: reader(uid),
    answer: { verdict: "date", value },
    now: new Date("2026-10-29T12:00:00Z"),
  });

beforeEach(() => {
  stored = new Map();
});

describe("isCountedReader", () => {
  it("counts a Google account or a confirmed address, not a bare password account", () => {
    expect(isCountedReader(reader("a"))).toBe(true);
    expect(
      isCountedReader(
        reader("b", {
          email_verified: false,
          firebase: {
            sign_in_provider: "google.com",
          } as DecodedIdToken["firebase"],
        }),
      ),
    ).toBe(true);
    expect(isCountedReader(reader("c", { email_verified: false }))).toBe(false);
  });
});

describe("recordAnswer", () => {
  it("keeps one answer and leaves the crop open", async () => {
    crop("c1");
    const recorded = await answer("a", "1979-07-15");
    expect(recorded).toEqual({
      settled: null,
      documentUrl: "https://bip.example.pl/c1.pdf",
      host: "bip.example.pl",
    });
    expect(stored.get("declarationAnswers/c1_a")).toMatchObject({
      extractId: "c1",
      uid: "a",
      verdict: "date",
      value: "1979-07-15",
      counted: true,
      day: "2026-10-29",
      imageHash: "hash",
    });
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "open",
      answerCount: 1,
      answers: { readings: { "1979-07-15": 1 }, unreadable: 0, empty: 0 },
    });
  });

  it("settles the crop when a second reader reads the same date", async () => {
    crop("c1");
    await answer("a", "1979-07-15");
    const recorded = await answer("b", "1979-07-15");
    expect(recorded.settled).toMatchObject({
      status: "agreed",
      value: "1979-07-15",
    });
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "agreed",
      agreed: { value: "1979-07-15", kind: "date", by: "readers", readers: 2 },
    });
  });

  it("replaces a reader's earlier answer instead of adding a voice", async () => {
    crop("c1");
    await answer("a", "1979-07-15");
    await answer("a", "1979-07-15");
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "open",
      answerCount: 1,
    });
  });

  it("keeps an answer to a crop already settled, and changes nothing", async () => {
    crop("c1", { status: "agreed", agreed: { value: "1979-07-15" } });
    const recorded = await answer("c", "1980-01-01");
    expect(recorded.settled).toBeNull();
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "agreed",
      agreed: { value: "1979-07-15" },
    });
    expect(stored.has("declarationAnswers/c1_c")).toBe(true);
  });

  it("refuses a crop that was withdrawn", async () => {
    crop("c1", { status: "withdrawn" });
    await expect(answer("a", "1979-07-15")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("stops a reader at the daily limit, but never counts a skip", async () => {
    crop("c1");
    stored.set("declarationReaderLimits/2026-10-29_a", {
      count: READER_DAILY_LIMIT,
    });
    await expect(answer("a", "1979-07-15")).rejects.toMatchObject({
      statusCode: 429,
    });
    await recordAnswer(firestore, {
      extractId: "c1",
      user: reader("a"),
      answer: { verdict: "skip" },
      now: new Date("2026-10-29T12:00:00Z"),
    });
    expect(stored.get("declarationAnswers/c1_a")).toMatchObject({
      verdict: "skip",
      counted: false,
    });
  });
});

describe("queueFor", () => {
  it("serves drafts first, finishes half-read crops first, and never repeats one", async () => {
    crop("published", { priority: 3, rand: 0.1 });
    crop("fresh", { priority: 0, answerCount: 0, rand: 0.2 });
    crop("half-read", { priority: 0, answerCount: 1, rand: 0.9 });
    crop("dated-draft", { priority: 1, rand: 0.3 });
    crop("settled", { status: "agreed", rand: 0.05 });
    stored.set("declarationAnswers/fresh_a", {
      uid: "a",
      counted: true,
      day: "2026-10-29",
    });

    const queue = await queueFor(firestore, "a", 5);

    expect([queue.task?.id, ...queue.upcoming.map((t) => t.id)]).toEqual([
      "half-read",
      "dated-draft",
      "published",
    ]);
    expect(queue.task).toMatchObject({
      unit: "Strzelin",
      office: "Rada gminy",
      declarationYear: 2023,
      images: {
        date: `data:image/png;base64,${PNG.toString("base64")}`,
        name: null,
      },
    });
    // Blind: nothing that names the person or the form.
    expect(JSON.stringify(queue)).not.toMatch(/kowalska|bip\.example\.pl/);
    expect(queue.open).toBe(4);
    expect(queue.mine.total).toBe(1);
  });

  it("leaves out the crops the page already holds", async () => {
    crop("one", { rand: 0.1 });
    crop("two", { rand: 0.2 });
    const queue = await queueFor(firestore, "a", 3, new Set(["one"]));
    expect(queue.task?.id).toBe("two");
    expect(queue.upcoming).toEqual([]);
  });
});
