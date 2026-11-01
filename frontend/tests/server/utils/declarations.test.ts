import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";
import { findsOf } from "../../../server/utils/declarationFinds";
import { FOUND_LIST_LIMIT } from "../../../shared/declarations";
import {
  admitToQueue,
  anonymousUid,
  CLAIM_LIMIT,
  claimAnswers,
  getReader,
  isCountedReader,
  queueFor,
  recordAnswer,
  READER_DAILY_LIMIT,
  ROOM_SHARDS,
  VOTELESS_ASK_DAILY_LIMIT,
  VOTELESS_DAILY_LIMIT,
  type DeclarationReader,
} from "../../../server/utils/declarations";

const { verifyIdToken } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globals.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // Node hands h3 the headers lower-cased, whatever the browser sent.
  globals.getRequestHeader = (
    event: { headers: Record<string, string> },
    name: string,
  ) => event.headers[name.toLowerCase()];
  return { verifyIdToken: vi.fn() };
});

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { fromDate: (date: Date) => ({ iso: date.toISOString() }) },
  FieldValue: { increment: (by: number) => ({ __increment: by }) },
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken }),
}));

/**
 * A Firestore double that runs queries for real over an in-memory map:
 * equality filters, ordering on several fields, a cursor, limits, count(),
 * getAll, increments, and transactions whose writes land only when the
 * function returns. It notes the queries transactions run, and how many
 * answers each read. A transaction that reads a document in `aborting` fails
 * as one that lost to contention every time the client library tried it,
 * as many times as the map says, and writes nothing.
 */
type Data = Record<string, unknown>;
let stored: Map<string, Data>;
let reads: { filters: [string, unknown][]; docs: number }[];
let aborting: Map<string, number>;

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

/** A write as Firestore makes it: `merge` keeps the fields not sent, and an
 * increment adds to what is stored. */
function write(path: string, data: Data, merge: boolean) {
  const before = merge ? (stored.get(path) ?? {}) : {};
  const after: Data = { ...before };
  for (const [field, value] of Object.entries(data)) {
    const by = (value as { __increment?: number } | null)?.__increment;
    after[field] =
      typeof by === "number" ? Number(before[field] ?? 0) + by : value;
  }
  stored.set(path, after);
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
    doc: (id: string) => {
      const path = `${collection}/${id}`;
      return {
        path,
        id,
        get: async () => snapshot(path),
        set: async (data: Data, options?: { merge?: boolean }) =>
          write(path, data, options?.merge === true),
      };
    },
  }),
  getAll: async (...refs: { path: string }[]) =>
    refs.map((ref) => snapshot(ref.path)),
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const writes: (() => void)[] = [];
    const tx = {
      get: async (target: { path?: string; __query?: Query }) => {
        if (target.__query) {
          const docs = run(target.__query);
          reads.push({ filters: target.__query.filters, docs: docs.length });
          return { docs, empty: docs.length === 0 };
        }
        const times = aborting.get(target.path!) ?? 0;
        if (times > 0) {
          aborting.set(target.path!, times - 1);
          throw Object.assign(
            new Error(
              "10 ABORTED: Aborted due to cross-transaction contention.",
            ),
            { code: 10 },
          );
        }
        return snapshot(target.path!);
      },
      set: (ref: { path: string }, data: Data, options?: { merge?: boolean }) =>
        writes.push(() => write(ref.path, data, options?.merge === true)),
      update: (ref: { path: string }, data: Data) =>
        writes.push(() => write(ref.path, data, true)),
      delete: (ref: { path: string }) =>
        writes.push(() => stored.delete(ref.path)),
    };
    const result = await fn(tx);
    for (const pending of writes) pending();
    return result;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firestore = db as any;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const NOW = new Date("2026-10-29T12:00:00Z");
const LIMITS = "declarationReaderLimits/2026-10-29";

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

/** A signed-in account, as its token decodes: a confirmed address unless
 * told otherwise. */
function account(uid: string, fields: Partial<DecodedIdToken> = {}) {
  return {
    uid,
    email_verified: true,
    firebase: { sign_in_provider: "password" },
    ...fields,
  } as unknown as DecodedIdToken;
}

/** A browser's reader id, as `crypto.randomUUID()` makes one. */
const readerId = (n: number) =>
  `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, "0")}`;

const voter = (uid: string): DeclarationReader => ({
  uid,
  votes: true,
  anonymous: false,
});
const unconfirmed = (uid: string): DeclarationReader => ({
  uid,
  votes: false,
  anonymous: false,
});
const stranger = (n: number): DeclarationReader => ({
  uid: anonymousUid(readerId(n)),
  votes: false,
  anonymous: true,
});

const answerAs = (reader: DeclarationReader, value: string, extractId = "c1") =>
  recordAnswer(firestore, {
    extractId,
    reader,
    answer: { verdict: "date", value },
    now: NOW,
  });

const answer = (uid: string, value: string, extractId = "c1") =>
  answerAs(voter(uid), value, extractId);

const skipAs = (reader: DeclarationReader, extractId = "c1") =>
  recordAnswer(firestore, {
    extractId,
    reader,
    answer: { verdict: "skip" },
    now: NOW,
  });

const claim = (n: number, user: DecodedIdToken) =>
  claimAnswers(firestore, { readerId: readerId(n), user, now: NOW });

type Room = "voteless-answers" | "voteless-asks";

/** What readers without a vote have used of the day's room, every share of
 * it together. */
function used(room: Room): number {
  let total = 0;
  for (let n = 0; n < ROOM_SHARDS; n++) {
    total += Number(stored.get(`${LIMITS}_${room}_${n}`)?.count ?? 0);
  }
  return total;
}

/** Uses up the day's room, every share of it. */
function fill(room: Room, limit: number) {
  for (let n = 0; n < ROOM_SHARDS; n++) {
    stored.set(`${LIMITS}_${room}_${n}`, { count: limit / ROOM_SHARDS });
  }
}

beforeEach(() => {
  stored = new Map();
  reads = [];
  aborting = new Map();
  vi.clearAllMocks();
});

describe("isCountedReader", () => {
  it("counts a Google account or a confirmed address, not a bare password account", () => {
    expect(isCountedReader(account("a"))).toBe(true);
    expect(
      isCountedReader(
        account("b", {
          email_verified: false,
          firebase: {
            sign_in_provider: "google.com",
          } as DecodedIdToken["firebase"],
        }),
      ),
    ).toBe(true);
    expect(isCountedReader(account("c", { email_verified: false }))).toBe(
      false,
    );
  });
});

describe("getReader", () => {
  const request = (headers: Record<string, string>) =>
    getReader({ headers } as never);

  it("reads a signed-in reader by their token, with a vote", async () => {
    verifyIdToken.mockResolvedValue(account("a"));
    await expect(request({ authorization: "Bearer token" })).resolves.toEqual({
      uid: "a",
      votes: true,
      anonymous: false,
    });
  });

  it("lets an account without a confirmed address read, without a vote", async () => {
    verifyIdToken.mockResolvedValue(account("u", { email_verified: false }));
    await expect(request({ authorization: "Bearer token" })).resolves.toEqual({
      uid: "u",
      votes: false,
      anonymous: false,
    });
  });

  it("files a reader without an account under their reader id, lower-cased", async () => {
    await expect(
      request({ "x-reader-id": readerId(7).toUpperCase() }),
    ).resolves.toEqual({
      uid: `anon:${readerId(7)}`,
      votes: false,
      anonymous: true,
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("refuses a bad token even beside a reader id", async () => {
    verifyIdToken.mockRejectedValue(new Error("expired"));
    await expect(
      request({ authorization: "Bearer stale", "x-reader-id": readerId(7) }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      request({ authorization: "Basic abc", "x-reader-id": readerId(7) }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses a request with neither, or with a reader id that is no version 4 UUID", async () => {
    await expect(request({})).rejects.toMatchObject({ statusCode: 401 });
    for (const id of [
      "reader",
      `${readerId(7)}0`,
      // Version 1, and a version 4 without its variant bits.
      "0f8fad5b-d9cb-169f-a165-000000000007",
      "0f8fad5b-d9cb-469f-c165-000000000007",
      ` ${readerId(7)}`,
    ]) {
      await expect(request({ "x-reader-id": id })).rejects.toMatchObject({
        statusCode: 401,
      });
    }
  });
});

describe("recordAnswer", () => {
  it("keeps one answer and leaves the crop open", async () => {
    crop("c1");
    const recorded = await answer("a", "1979-07-15");
    expect(recorded).toEqual({
      settled: null,
      personIds: ["kowalska"],
    });
    expect(stored.get("declarationAnswers/c1_a")).toMatchObject({
      extractId: "c1",
      uid: "a",
      verdict: "date",
      value: "1979-07-15",
      votes: true,
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

  // A skip with a vote is a voice since three skips settle a crop as
  // unreadable, so it is held to the limit too; a
  // stranger's skip has no say and is not.
  it("stops a reader who votes at the daily limit, skips included", async () => {
    crop("c1");
    stored.set(`${LIMITS}_a`, { count: READER_DAILY_LIMIT });
    await expect(answer("a", "1979-07-15")).rejects.toMatchObject({
      statusCode: 429,
    });
    await expect(skipAs(voter("a"))).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(stored.has("declarationAnswers/c1_a")).toBe(false);

    stored.set(`${LIMITS}_anon:${readerId(1)}`, {
      count: READER_DAILY_LIMIT,
    });
    await skipAs(stranger(1));
    expect(
      stored.get(`declarationAnswers/c1_anon:${readerId(1)}`),
    ).toMatchObject({ verdict: "skip", counted: false });
  });

  it("counts a skip of a reader who votes in their day, but not in their readings", async () => {
    crop("c1");
    await skipAs(voter("a"));
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({ count: 1 });
    expect(stored.get("declarationAnswers/c1_a")).toMatchObject({
      verdict: "skip",
      counted: false,
      votes: true,
    });
  });

  it("settles a crop as unreadable on the third skip of readers who vote", async () => {
    crop("c1");
    expect((await skipAs(voter("a"))).settled).toBeNull();
    expect((await skipAs(voter("b"))).settled).toBeNull();
    // Strangers' skips add nothing.
    await skipAs(stranger(1));
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "open",
      answerCount: 2,
    });

    const third = await skipAs(voter("c"));

    expect(third.settled).toEqual({ status: "unreadable", readers: 3 });
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "unreadable",
      answerCount: 3,
      answers: { unreadable: 3 },
    });
  });

  it("keeps a reader's answer without an account as theirs, and leaves the crop as it was", async () => {
    crop("c1");
    const before = stored.get("declarationExtracts/c1");
    const recorded = await answerAs(stranger(1), "1979-07-15");

    expect(recorded.settled).toBeNull();
    expect(
      stored.get(`declarationAnswers/c1_anon:${readerId(1)}`),
    ).toMatchObject({
      uid: `anon:${readerId(1)}`,
      value: "1979-07-15",
      votes: false,
      counted: true,
      day: "2026-10-29",
      imageHash: "hash",
    });
    // Not written at all: neither the queue's order nor an admin's list
    // hears it, and an upload still finds the crop unread and may cut it
    // again (every write here stores a new object).
    expect(stored.get("declarationExtracts/c1")).toBe(before);
    expect(stored.get(`${LIMITS}_anon:${readerId(1)}`)).toMatchObject({
      count: 1,
    });
    expect(used("voteless-answers")).toBe(1);
  });

  it("never settles a crop on two answers without an account", async () => {
    crop("c1");
    await answerAs(stranger(1), "1979-07-15");
    const recorded = await answerAs(stranger(2), "1979-07-15");

    expect(recorded.settled).toBeNull();
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "open",
      answerCount: 0,
    });
  });

  it("never settles a crop on one voter and one answer without a vote", async () => {
    crop("c1");
    crop("c2");
    await answer("a", "1979-07-15", "c1");
    expect((await answerAs(stranger(1), "1979-07-15", "c1")).settled).toBe(
      null,
    );
    await answer("a", "1979-07-15", "c2");
    expect((await answerAs(unconfirmed("u"), "1979-07-15", "c2")).settled).toBe(
      null,
    );
    for (const id of ["c1", "c2"]) {
      expect(stored.get(`declarationExtracts/${id}`)).toMatchObject({
        status: "open",
        answerCount: 1,
      });
    }

    // A second voter settles it, on two readers.
    expect((await answer("b", "1979-07-15", "c1")).settled).toEqual({
      status: "agreed",
      value: "1979-07-15",
      kind: "date",
      readers: 2,
    });
  });

  it("reads none of a crop's answers without a vote, however many strangers gave them", async () => {
    crop("c1");
    for (let n = 1; n <= 50; n++) await answerAs(stranger(n), "1979-07-16");
    // A stranger's answer reads no other answer at all.
    expect(reads).toEqual([]);

    await answer("a", "1979-07-15");
    const recorded = await answer("b", "1979-07-15");

    // A voter's reads the answers that vote and nothing else.
    expect(reads).toEqual([
      {
        filters: [
          ["extractId", "c1"],
          ["votes", true],
        ],
        docs: 0,
      },
      {
        filters: [
          ["extractId", "c1"],
          ["votes", true],
        ],
        docs: 1,
      },
    ]);
    expect(recorded.settled).toMatchObject({ status: "agreed", readers: 2 });
  });

  it("lets an account without a confirmed address answer, without a vote, within the room for answers without one", async () => {
    crop("c1");
    const before = stored.get("declarationExtracts/c1");
    await answerAs(unconfirmed("u"), "1979-07-15");
    expect(stored.get("declarationAnswers/c1_u")).toMatchObject({
      votes: false,
      counted: true,
    });
    expect(stored.get("declarationExtracts/c1")).toBe(before);
    expect(stored.get(`${LIMITS}_u`)).toMatchObject({ count: 1 });
    expect(used("voteless-answers")).toBe(1);
  });

  it("holds a reader without an account to the daily limit of a reader", async () => {
    crop("c1");
    stored.set(`${LIMITS}_anon:${readerId(1)}`, { count: READER_DAILY_LIMIT });
    await expect(answerAs(stranger(1), "1979-07-15")).rejects.toMatchObject({
      statusCode: 429,
    });
    await expect(answerAs(stranger(2), "1979-07-15")).resolves.toMatchObject({
      settled: null,
    });
  });

  it("stops readers without a vote at the day's room for them, and asks for what lets them go on", async () => {
    crop("c1");
    fill("voteless-answers", VOTELESS_DAILY_LIMIT);

    const refused = answerAs(stranger(1), "1979-07-15");
    await expect(refused).rejects.toMatchObject({ statusCode: 429 });
    await expect(refused).rejects.toThrow(/załóż konto/);
    await expect(skipAs(stranger(1))).rejects.toMatchObject({
      statusCode: 429,
    });
    await expect(answerAs(unconfirmed("u"), "1979-07-15")).rejects.toThrow(
      /Potwierdź adres/,
    );
    expect(stored.has(`declarationAnswers/c1_anon:${readerId(1)}`)).toBe(false);
    expect(stored.has("declarationAnswers/c1_u")).toBe(false);
    expect(stored.has(`${LIMITS}_anon:${readerId(1)}`)).toBe(false);
    expect(used("voteless-answers")).toBe(VOTELESS_DAILY_LIMIT);

    // A reader who votes is not held by it.
    await expect(answer("a", "1979-07-15")).resolves.toMatchObject({
      settled: null,
    });
  });

  it("finds the room left in any share of it, and counts a skip there too", async () => {
    crop("c1");
    fill("voteless-answers", VOTELESS_DAILY_LIMIT);
    const share = VOTELESS_DAILY_LIMIT / ROOM_SHARDS;
    const last = `${LIMITS}_voteless-answers_7`;
    stored.set(last, { count: share - 1 });

    await skipAs(stranger(1));

    expect(stored.get(last)).toMatchObject({ count: share });
    await expect(skipAs(stranger(2))).rejects.toMatchObject({
      statusCode: 429,
    });
  });
});

describe("admitToQueue", () => {
  it("counts every ask of a reader without a vote, and none of a reader who votes", async () => {
    await admitToQueue(firestore, stranger(1), NOW);
    await admitToQueue(firestore, stranger(2), NOW);
    await admitToQueue(firestore, unconfirmed("u"), NOW);
    expect(used("voteless-asks")).toBe(3);

    fill("voteless-asks", VOTELESS_ASK_DAILY_LIMIT);
    fill("voteless-answers", VOTELESS_DAILY_LIMIT);
    await expect(
      admitToQueue(firestore, voter("a"), NOW),
    ).resolves.toBeUndefined();
  });

  it("refuses once the day's asks are used up", async () => {
    fill("voteless-asks", VOTELESS_ASK_DAILY_LIMIT);
    await expect(admitToQueue(firestore, stranger(1), NOW)).rejects.toThrow(
      /załóż konto/,
    );
    await expect(
      admitToQueue(firestore, unconfirmed("u"), NOW),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("serves no crop once the day's answers without a vote are used up, as any reading of it would be refused", async () => {
    fill("voteless-answers", VOTELESS_DAILY_LIMIT);
    await expect(
      admitToQueue(firestore, stranger(1), NOW),
    ).rejects.toMatchObject({ statusCode: 429 });
    await expect(
      admitToQueue(firestore, unconfirmed("u"), NOW),
    ).rejects.toThrow(/Potwierdź adres/);
  });
});

describe("queueFor", () => {
  it("serves drafts first, finishes half-read crops first, and never repeats one", async () => {
    crop("published", { priority: 3, rand: 0.1 });
    crop("fresh", { priority: 0, answerCount: 0, rand: 0.2 });
    crop("half-read", { priority: 0, answerCount: 1, rand: 0.9 });
    crop("undated-draft", { priority: 1, rand: 0.3 });
    crop("settled", { status: "agreed", rand: 0.05 });
    stored.set("declarationAnswers/fresh_a", {
      uid: "a",
      counted: true,
      day: "2026-10-29",
    });

    const queue = await queueFor(firestore, "a", 5);

    expect([queue.task?.id, ...queue.upcoming.map((t) => t.id)]).toEqual([
      "half-read",
      "undated-draft",
      "published",
    ]);
    expect(queue.task).toMatchObject({
      unit: "Strzelin",
      office: "Rada gminy",
      declarationYear: 2023,
      // The whole form, for a reader who wants to see the line in it.
      documentUrl: "https://bip.example.pl/half-read.pdf",
      host: "bip.example.pl",
      images: {
        date: `data:image/png;base64,${PNG.toString("base64")}`,
        name: null,
      },
    });
    // Nothing that names the person but the form, and no date.
    expect(JSON.stringify(queue)).not.toMatch(
      /kowalska|birth|\d{4}-\d{2}-\d{2}/,
    );
    expect(queue.open).toBe(4);
    expect(queue.mine.total).toBe(1);
  });

  // The form asks for the date alone for now, so a
  // reader, with or without an account, is not sent the line with the name
  // either (READ_NAMES).
  it("sends no name crop while readers are not asked for names", async () => {
    crop("named", {
      imageSize: {
        date: { width: 951, height: 105 },
        name: { width: 1160, height: 94 },
      },
    });
    stored.set("declarationExtractImages/named", { date: PNG, name: PNG });

    const queue = await queueFor(firestore, "a", 1);

    expect(queue.task?.images.name).toBeNull();
    expect(queue.task?.imageSize.name).toBeNull();
  });

  it("leaves out the crops the page already holds", async () => {
    crop("one", { rand: 0.1 });
    crop("two", { rand: 0.2 });
    const queue = await queueFor(firestore, "a", 3, new Set(["one"]));
    expect(queue.task?.id).toBe("two");
    expect(queue.upcoming).toEqual([]);
  });

  it("serves a reader without an account like any other: never a crop twice, and their own count", async () => {
    crop("one", { rand: 0.1 });
    crop("two", { rand: 0.2 });
    await answerAs(stranger(1), "1979-07-15", "one");

    const queue = await queueFor(firestore, stranger(1).uid, 3);

    expect([queue.task?.id, ...queue.upcoming.map((t) => t.id)]).toEqual([
      "two",
    ]);
    expect(queue.mine.total).toBe(1);
  });

  it("finishes first the crops a vote short, not those only answers without a vote reached", async () => {
    crop("voted", { rand: 0.9 });
    crop("unvoted", { rand: 0.1 });
    await answer("a", "1979-07-15", "voted");
    await answerAs(stranger(1), "1979-07-15", "unvoted");
    await answerAs(stranger(2), "1979-07-15", "unvoted");

    const queue = await queueFor(firestore, "b", 3);

    expect([queue.task?.id, ...queue.upcoming.map((t) => t.id)]).toEqual([
      "voted",
      "unvoted",
    ]);
  });
});

describe("a reader's finds", () => {
  it("counts the people a reader found in their queue's „Znaleziono”", async () => {
    crop("c1");
    stored.set("declarationReaderFinds/a_kowalska", {
      uid: "a",
      personId: "kowalska",
    });
    stored.set("declarationReaderFinds/a_nowak", {
      uid: "a",
      personId: "nowak",
    });
    stored.set("declarationReaderFinds/b_kowalska", {
      uid: "b",
      personId: "kowalska",
    });

    expect((await queueFor(firestore, "a", 1)).mine.found).toBe(2);
    expect((await queueFor(firestore, "c", 1)).mine.found).toBe(0);
  });

  it("moves what a browser found to the account it signs in to, once a person", async () => {
    crop("c1");
    await answerAs(stranger(1), "1979-07-15", "c1");
    const anon = `anon:${readerId(1)}`;
    stored.set(`declarationReaderFinds/${anon}_kowalska`, {
      uid: anon,
      personId: "kowalska",
      extractId: "c1",
    });
    stored.set(`declarationReaderFinds/${anon}_nowak`, {
      uid: anon,
      personId: "nowak",
      extractId: "c9",
    });
    // The account found Nowak itself already.
    stored.set("declarationReaderFinds/a_nowak", {
      uid: "a",
      personId: "nowak",
      extractId: "c8",
    });

    await claim(1, account("a"));

    expect(
      [...stored.keys()].filter((path) =>
        path.startsWith("declarationReaderFinds/"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "declarationReaderFinds/a_kowalska",
        "declarationReaderFinds/a_nowak",
      ]),
    );
    expect(stored.has(`declarationReaderFinds/${anon}_kowalska`)).toBe(false);
    expect(stored.has(`declarationReaderFinds/${anon}_nowak`)).toBe(false);
    expect((await queueFor(firestore, "a", 1)).mine.found).toBe(2);
  });

  // A claim that failed after its answers had moved, and before its finds
  // did: the page kept the id, and the next claim has only finds to move.
  it("moves what a browser found when no answer is left to move with it", async () => {
    const anon = `anon:${readerId(1)}`;
    stored.set(`declarationReaderFinds/${anon}_kowalska`, {
      uid: anon,
      personId: "kowalska",
      extractId: "c1",
    });

    expect(await claim(1, account("a"))).toEqual({
      claimed: 0,
      settled: [],
      left: 0,
    });

    expect(stored.has(`declarationReaderFinds/${anon}_kowalska`)).toBe(false);
    expect(stored.get("declarationReaderFinds/a_kowalska")).toMatchObject({
      uid: "a",
      personId: "kowalska",
    });
  });

  /** A person page, live or a draft. */
  function personPage(id: string, fields: Data = {}) {
    stored.set(`nodes/${id}`, {
      type: "person",
      name: `Jan ${id}`,
      published: true,
      ...fields,
    });
  }

  /** `uid` found `personId` through crop `extractId`, at `at` (a number here:
   * the double orders by it as Firestore orders the stored instant). */
  function found(uid: string, personId: string, extractId: string, at: number) {
    stored.set(`declarationReaderFinds/${uid}_${personId}`, {
      uid,
      personId,
      extractId,
      at,
    });
  }

  it("lists whom a reader found, the newest first, with the declaration that found them", async () => {
    crop("c1");
    crop("c2", {
      declarationYear: 2024,
      units: [{ teryt: "0264011", unitName: "Testowice", office: "Burmistrz" }],
    });
    personPage("szablonowy");
    personPage("atrapowa", { published: false });
    found("a", "szablonowy", "c1", 1);
    found("a", "atrapowa", "c2", 2);
    found("b", "szablonowy", "c1", 3);

    expect(await findsOf(firestore, "a")).toEqual({
      total: 2,
      people: [
        {
          id: "atrapowa",
          name: "Jan atrapowa",
          published: false,
          unit: "Testowice",
          office: "Burmistrz",
          declarationYear: 2024,
        },
        {
          id: "szablonowy",
          name: "Jan szablonowy",
          published: true,
          unit: "Strzelin",
          office: "Rada gminy",
          declarationYear: 2023,
        },
      ],
    });
    expect(await findsOf(firestore, "c")).toEqual({ people: [], total: 0 });
  });

  it("lists a page merged since as the page it went into, once", async () => {
    crop("c1");
    personPage("stara", { merged_into: "nowa" });
    personPage("nowa");
    found("a", "stara", "c1", 1);
    found("a", "nowa", "c1", 2);

    const { people, total } = await findsOf(firestore, "a");
    expect(people.map((person) => person.id)).toEqual(["nowa"]);
    expect(total).toBe(2);
  });

  it("leaves out a page that is gone, removed or not a person, and counts it", async () => {
    crop("c1");
    personPage("jest");
    personPage("usunieta", { deleted: true });
    personPage("firma", { type: "place" });
    found("a", "jest", "c1", 1);
    found("a", "usunieta", "c1", 2);
    found("a", "firma", "c1", 3);
    found("a", "nie-ma", "c1", 4);

    const { people, total } = await findsOf(firestore, "a");
    expect(people.map((person) => person.id)).toEqual(["jest"]);
    expect(total).toBe(4);
  });

  it("lists a person whose crop is gone without the declaration", async () => {
    personPage("szablonowy");
    found("a", "szablonowy", "zniknal", 1);

    expect((await findsOf(firestore, "a")).people).toEqual([
      {
        id: "szablonowy",
        name: "Jan szablonowy",
        published: true,
        unit: "",
        office: null,
        declarationYear: null,
      },
    ]);
  });

  it("lists the newest of a long run, and counts them all", async () => {
    crop("c1");
    for (let n = 0; n <= FOUND_LIST_LIMIT; n++) {
      personPage(`p${n}`);
      found("a", `p${n}`, "c1", n);
    }

    const { people, total } = await findsOf(firestore, "a");
    expect(people).toHaveLength(FOUND_LIST_LIMIT);
    expect(people[0]!.id).toBe(`p${FOUND_LIST_LIMIT}`);
    expect(people.map((person) => person.id)).not.toContain("p0");
    expect(total).toBe(FOUND_LIST_LIMIT + 1);
  });

  it("has the index its query needs: a reader's finds, the newest first", () => {
    const file = existsSync(resolve(process.cwd(), "firestore.indexes.json"))
      ? resolve(process.cwd(), "firestore.indexes.json")
      : resolve(process.cwd(), "..", "firestore.indexes.json");
    const indexes = (
      JSON.parse(readFileSync(file, "utf8")).indexes as {
        collectionGroup: string;
        fields: { fieldPath: string; order: string }[];
      }[]
    )
      .filter((index) => index.collectionGroup === "declarationReaderFinds")
      .map((index) =>
        index.fields.map((f) => `${f.fieldPath} ${f.order}`).join(", "),
      );
    expect(indexes).toContain("uid ASCENDING, at DESCENDING");
  });
});

describe("claimAnswers", () => {
  it("moves a browser's answers onto the account, with the account's vote", async () => {
    crop("c1");
    crop("c2");
    await answerAs(stranger(1), "1979-07-15", "c1");
    await skipAs(stranger(1), "c2");

    const result = await claim(1, account("a"));

    expect(result).toEqual({ claimed: 2, settled: [], left: 0 });
    expect(stored.has(`declarationAnswers/c1_anon:${readerId(1)}`)).toBe(false);
    expect(stored.get("declarationAnswers/c1_a")).toMatchObject({
      extractId: "c1",
      uid: "a",
      verdict: "date",
      value: "1979-07-15",
      votes: true,
      counted: true,
      day: "2026-10-29",
      imageHash: "hash",
      claimedFrom: `anon:${readerId(1)}`,
    });
    expect(stored.get("declarationAnswers/c2_a")).toMatchObject({
      verdict: "skip",
      counted: false,
    });
    // The crop hears the answer now.
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "open",
      answerCount: 1,
      answers: { readings: { "1979-07-15": 1 } },
    });
    // And the account's own count has it, as does its limit for the day,
    // which never counts a skip.
    expect((await queueFor(firestore, "a", 1)).mine.total).toBe(1);
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({ count: 1 });
  });

  it("keeps the account's own answer to a crop it answered itself, and gives back the vote it took for the other", async () => {
    crop("c1");
    await answer("a", "1980-01-01");
    await answerAs(stranger(1), "1979-07-15");

    expect(await claim(1, account("a"))).toEqual({
      claimed: 0,
      settled: [],
      left: 0,
    });

    expect(stored.get("declarationAnswers/c1_a")).toMatchObject({
      value: "1980-01-01",
    });
    expect(stored.get("declarationAnswers/c1_a")).not.toHaveProperty(
      "claimedFrom",
    );
    expect(stored.has(`declarationAnswers/c1_anon:${readerId(1)}`)).toBe(false);
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      answerCount: 1,
      answers: { readings: { "1980-01-01": 1 } },
    });
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({ count: 1 });
  });

  it("lets the browser's reading that votes stand over one the account gave before its address was confirmed", async () => {
    crop("c1");
    await answerAs(unconfirmed("u"), "1980-01-01");
    await answerAs(stranger(1), "1979-07-15");

    expect(await claim(1, account("u"))).toEqual({
      claimed: 1,
      settled: [],
      left: 0,
    });

    expect(stored.get("declarationAnswers/c1_u")).toMatchObject({
      value: "1979-07-15",
      votes: true,
      claimedFrom: `anon:${readerId(1)}`,
    });
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      answerCount: 1,
      answers: { readings: { "1979-07-15": 1 } },
    });
  });

  it("settles a crop once two accounts that vote have claimed answers that agree", async () => {
    crop("c1");
    await answerAs(stranger(1), "1979-07-15");
    await answerAs(stranger(2), "1979-07-15");

    expect(await claim(1, account("a"))).toEqual({
      claimed: 1,
      settled: [],
      left: 0,
    });
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "open",
    });

    const second = await claim(2, account("b"));

    expect(second).toEqual({
      claimed: 1,
      settled: [
        {
          extractId: "c1",
          settlement: {
            status: "agreed",
            value: "1979-07-15",
            kind: "date",
            readers: 2,
          },
        },
      ],
      left: 0,
    });
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      status: "agreed",
      agreed: { value: "1979-07-15", kind: "date", by: "readers", readers: 2 },
      answerCount: 2,
    });
  });

  it("refuses an account without a confirmed address, and leaves the answers for a claim once it is confirmed", async () => {
    crop("c1");
    await answerAs(stranger(1), "1979-07-15");
    const before = new Map(stored);

    const refused = claim(1, account("u", { email_verified: false }));

    await expect(refused).rejects.toMatchObject({ statusCode: 403 });
    await expect(refused).rejects.toThrow(/Potwierdź adres/);
    expect(stored).toEqual(before);

    expect(await claim(1, account("u"))).toEqual({
      claimed: 1,
      settled: [],
      left: 0,
    });
    expect(stored.get("declarationAnswers/c1_u")).toMatchObject({
      votes: true,
    });
  });

  // The page makes the id with its first ask for crops, answered or not, and
  // the 403 tells the reader their readings will move: of a browser that only
  // looked, that would be untrue.
  it("answers 0 to an account without a confirmed address for a browser with no reading to move, and moves nothing", async () => {
    crop("c1");
    // Another browser's reading is not this one's to wait for.
    await answerAs(stranger(3), "1979-07-15");
    const before = new Map(stored);

    expect(await claim(1, account("u", { email_verified: false }))).toEqual({
      claimed: 0,
      settled: [],
      left: 0,
    });
    expect(stored).toEqual(before);

    // A skip is no reading, as the reader's own count has it.
    await skipAs(stranger(2), "c1");
    const skipped = new Map(stored);

    expect(await claim(2, account("u", { email_verified: false }))).toEqual({
      claimed: 0,
      settled: [],
      left: 0,
    });
    expect(stored).toEqual(skipped);
  });

  it("votes within the account's daily limit, on the day each answer was given, and moves the rest without a vote", async () => {
    crop("c1");
    crop("c2");
    crop("c3");
    stored.set(`${LIMITS}_a`, { count: READER_DAILY_LIMIT - 1 });
    await answerAs(stranger(1), "1979-07-15", "c1");
    await answerAs(stranger(1), "1979-07-15", "c2");
    const from = anonymousUid(readerId(1));
    stored.set(`declarationAnswers/c3_${from}`, {
      extractId: "c3",
      uid: from,
      verdict: "date",
      value: "1979-07-15",
      votes: false,
      counted: true,
      day: "2026-10-28",
      imageHash: "hash",
    });

    expect((await claim(1, account("a"))).claimed).toBe(3);

    // Today had room for one more; the day before, for all of its.
    const today = ["c1", "c2"].map(
      (id) => stored.get(`declarationAnswers/${id}_a`)!.votes,
    );
    expect(today.sort()).toEqual([false, true]);
    expect(stored.get("declarationAnswers/c3_a")).toMatchObject({
      votes: true,
    });
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({
      count: READER_DAILY_LIMIT,
    });
    expect(stored.get("declarationReaderLimits/2026-10-28_a")).toMatchObject({
      count: 1,
    });
  });

  it("lets no account vote on more crops a day by claiming one browser after another", async () => {
    crop("c1");
    crop("c2");
    stored.set(`${LIMITS}_a`, { count: READER_DAILY_LIMIT - 1 });
    await answerAs(stranger(1), "1979-07-15", "c1");
    await answerAs(stranger(2), "1979-07-15", "c2");

    await claim(1, account("a"));
    await claim(2, account("a"));

    expect(stored.get("declarationAnswers/c1_a")).toMatchObject({
      votes: true,
    });
    expect(stored.get("declarationAnswers/c2_a")).toMatchObject({
      votes: false,
    });
    expect(stored.get("declarationExtracts/c2")).toMatchObject({
      answerCount: 0,
    });
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({
      count: READER_DAILY_LIMIT,
    });
  });

  it("drops an answer read off a picture the crop has since been cut again from", async () => {
    crop("c1");
    await answerAs(stranger(1), "1979-07-15");
    crop("c1", { imageHash: "recut" });

    expect(await claim(1, account("a"))).toEqual({
      claimed: 0,
      settled: [],
      left: 0,
    });

    expect(stored.has(`declarationAnswers/c1_anon:${readerId(1)}`)).toBe(false);
    expect(stored.has("declarationAnswers/c1_a")).toBe(false);
    expect(stored.get("declarationExtracts/c1")).toMatchObject({
      answerCount: 0,
    });
    // And the vote taken for it is given back.
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({ count: 0 });
  });

  it("finds nothing the second time", async () => {
    crop("c1");
    await answerAs(stranger(1), "1979-07-15");
    await claim(1, account("a"));
    const paths = [...stored.keys()].sort();
    const moved = stored.get("declarationAnswers/c1_a");
    const extract = stored.get("declarationExtracts/c1");
    const limit = stored.get(`${LIMITS}_a`);

    expect(await claim(1, account("a"))).toEqual({
      claimed: 0,
      settled: [],
      left: 0,
    });
    // Nothing written: every write here stores a new object.
    expect([...stored.keys()].sort()).toEqual(paths);
    expect(stored.get("declarationAnswers/c1_a")).toBe(moved);
    expect(stored.get("declarationExtracts/c1")).toBe(extract);
    expect(stored.get(`${LIMITS}_a`)).toBe(limit);
  });

  it("leaves another browser's answers alone", async () => {
    crop("c1");
    await answerAs(stranger(1), "1979-07-15");
    await answerAs(stranger(2), "1979-07-16");

    await claim(1, account("a"));

    expect(
      stored.get(`declarationAnswers/c1_anon:${readerId(2)}`),
    ).toMatchObject({ value: "1979-07-16", votes: false });
  });

  it(`moves at most ${CLAIM_LIMIT} answers a claim`, async () => {
    const from = anonymousUid(readerId(1));
    for (let i = 0; i <= CLAIM_LIMIT; i++) {
      stored.set(`declarationAnswers/x${i}_${from}`, {
        extractId: `x${i}`,
        uid: from,
        verdict: "date",
        value: "1979-07-15",
        votes: false,
        counted: true,
        day: "2026-10-28",
      });
    }

    expect((await claim(1, account("a"))).claimed).toBe(CLAIM_LIMIT);
    expect((await claim(1, account("a"))).claimed).toBe(1);
    // All given on one day, so a day's worth of them vote.
    const voting = [...stored.entries()].filter(
      ([path, data]) =>
        path.startsWith("declarationAnswers/") && data.votes === true,
    );
    expect(voting).toHaveLength(READER_DAILY_LIMIT);
  });

  // 2026-10-31: one of twenty crops lost to contention, and the claim stopped
  // with eight readings under the browser's id.
  it("moves the rest when one crop's transaction fails among the others, and that crop once they are done", async () => {
    // More crops than a claim works on at once, so another round follows the
    // one the failure is in.
    const crops = Array.from({ length: 25 }, (_, i) => `c${i}`);
    for (const id of crops) {
      crop(id);
      await answerAs(stranger(1), "1979-07-15", id);
    }
    aborting.set("declarationExtracts/c3", 1);

    expect(await claim(1, account("a"))).toEqual({
      claimed: 25,
      settled: [],
      left: 0,
    });
    for (const id of crops) {
      expect(stored.get(`declarationAnswers/${id}_a`)).toMatchObject({
        votes: true,
      });
    }
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({ count: 25 });
  });

  it("leaves what fails alone too under the browser's id, gives back its votes, and moves it with the next claim", async () => {
    crop("c1");
    crop("c2");
    crop("c3");
    for (const id of ["c1", "c2", "c3"]) {
      await answerAs(stranger(1), "1979-07-15", id);
    }
    const from = anonymousUid(readerId(1));
    stored.set(`declarationReaderFinds/${from}_kowalska`, {
      uid: from,
      personId: "kowalska",
      extractId: "c1",
    });
    // c1 fails with the others and alone; c2 with the others only, and is
    // not tried alone once c1 has failed there.
    aborting.set("declarationExtracts/c1", 2);
    aborting.set("declarationExtracts/c2", 1);

    expect(await claim(1, account("a"))).toEqual({
      claimed: 1,
      settled: [],
      left: 2,
    });
    expect(stored.get(`declarationAnswers/c1_${from}`)).toMatchObject({
      votes: false,
    });
    expect(stored.get(`declarationAnswers/c2_${from}`)).toMatchObject({
      votes: false,
    });
    expect(stored.get("declarationAnswers/c3_a")).toMatchObject({
      votes: true,
    });
    // The votes taken for the two are given back, and the finds go to the
    // account all the same.
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({ count: 1 });
    expect(stored.get("declarationReaderFinds/a_kowalska")).toMatchObject({
      uid: "a",
    });

    expect(await claim(1, account("a"))).toEqual({
      claimed: 2,
      settled: [],
      left: 0,
    });
    expect(stored.get("declarationAnswers/c1_a")).toMatchObject({
      votes: true,
    });
    expect(stored.get(`${LIMITS}_a`)).toMatchObject({ count: 3 });
  });
});
