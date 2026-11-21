import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../../server/api/ingest/declarations/employment.post";
import { openEmploymentOf } from "../../../../server/utils/declarationEmployment";
import {
  nextTasks,
  queueFor,
  recordAnswer,
  type DeclarationReader,
} from "../../../../server/utils/declarations";

/**
 * The upload of the bands to read posts off (`upload --employment`): its
 * gate and limits, where a band is kept, when it opens, and that the date
 * flow never sees it. A Firestore double runs queries (filters on nested
 * fields, ordering, cursors, counts), batches and transactions for real over
 * an in-memory map, so the date queue and the date answer run here too, on
 * the same documents.
 */
const { FakeTimestamp, DELETE, Increment, mocks } = vi.hoisted(() => {
  const NOW = Date.parse("2026-11-20T12:00:00Z");
  class FakeTimestamp {
    constructor(readonly millis: number) {}
    static now() {
      return new FakeTimestamp(NOW);
    }
    static fromDate(date: Date) {
      return new FakeTimestamp(date.getTime());
    }
    toMillis() {
      return this.millis;
    }
    toDate() {
      return new Date(this.millis);
    }
  }
  class Increment {
    constructor(readonly by: number) {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return {
    FakeTimestamp,
    DELETE: Symbol("delete"),
    Increment,
    mocks: { getUser: vi.fn(), readBody: vi.fn(), body: undefined as unknown },
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => db,
  Timestamp: FakeTimestamp,
  FieldValue: {
    delete: () => DELETE,
    increment: (by: number) => new Increment(by),
  },
}));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
// `requireDatascience` stays real; only the token lookup is faked.
vi.mock("../../../../server/utils/auth", async (original) => ({
  ...(await original<typeof import("../../../../server/utils/auth")>()),
  getUser: mocks.getUser,
}));

/** As h3's: a body the schema refuses is a 400. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).readValidatedBody = async (
  _event: unknown,
  parse: (raw: unknown) => unknown,
) => {
  mocks.readBody();
  try {
    return parse(mocks.body);
  } catch (error) {
    throw Object.assign(new Error("Validation Error"), {
      statusCode: 400,
      data: error,
    });
  }
};

// ---------------------------------------------------------------------------
// The double
// ---------------------------------------------------------------------------

type Data = Record<string, unknown>;
let stored: Map<string, Data>;

function isPlain(value: unknown): value is Data {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (isPlain(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [key, clone(each)]),
    ) as T;
  }
  return value;
}

function at(data: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) => (isPlain(value) ? value[key] : undefined),
      data,
    );
}

function order(a: unknown, b: unknown): number {
  const key = (v: unknown) => (v instanceof FakeTimestamp ? v.millis : v);
  const [x, y] = [key(a), key(b)] as [number, number];
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

function passes(value: unknown, op: string, wanted: unknown): boolean {
  if (op === "==") return value === wanted;
  if (op === "in") return (wanted as unknown[]).includes(value);
  if (op === "array-contains") {
    return Array.isArray(value) && value.includes(wanted);
  }
  throw new Error(`operator ${op}`);
}

class FakeDocRef {
  constructor(
    readonly collection: string,
    readonly id: string,
  ) {}
  get path() {
    return `${this.collection}/${this.id}`;
  }
  async get() {
    return snapshot(this.path);
  }
  async set(data: Data, options?: { merge?: boolean }) {
    commit([[this.path, options?.merge ? "merge" : "set", data]]);
  }
  async update(data: Data) {
    commit([[this.path, "update", data]]);
  }
}

function snapshot(path: string) {
  const data = stored.get(path);
  const slash = path.indexOf("/");
  const id = path.slice(slash + 1);
  return {
    id,
    ref: new FakeDocRef(path.slice(0, slash), id),
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : clone(data)),
    get: (field: string) => clone(at(data, field)),
  };
}

/** A value as a write leaves it: a delete takes it away, an increment adds
 * to what was there. */
function written(before: unknown, value: unknown): unknown {
  if (value === DELETE) return undefined;
  if (value instanceof Increment) {
    return (typeof before === "number" ? before : 0) + value.by;
  }
  return value;
}

/** `set` with `merge`: maps merge field by field, all the way down. */
function merged(before: unknown, after: unknown): unknown {
  if (!isPlain(after)) return written(before, after);
  const out: Data = isPlain(before) ? { ...before } : {};
  for (const [key, value] of Object.entries(after)) {
    const next = merged(out[key], value);
    if (next === undefined) Reflect.deleteProperty(out, key);
    else out[key] = next;
  }
  return out;
}

type Write = [string, "set" | "merge" | "update" | "delete", Data];

/** Applies writes all together, or none if one of them fails. */
function commit(batch: readonly Write[]) {
  const next = new Map(stored);
  for (const [path, kind, data] of batch) {
    const current = next.get(path);
    if (kind === "delete") {
      next.delete(path);
      continue;
    }
    if (kind === "update" && !current) throw new Error(`NOT_FOUND ${path}`);
    let doc: Data;
    if (kind === "update") {
      // Dotted keys are paths; a map given whole replaces the one there.
      doc = clone(current!);
      for (const [key, value] of Object.entries(data)) {
        const parts = key.split(".");
        let target = doc;
        for (const part of parts.slice(0, -1)) {
          if (!isPlain(target[part])) target[part] = {};
          target = target[part] as Data;
        }
        const last = parts.at(-1)!;
        const value2 = isPlain(value)
          ? merged({}, value)
          : written(target[last], value);
        if (value2 === undefined) Reflect.deleteProperty(target, last);
        else target[last] = value2;
      }
    } else {
      doc = merged(kind === "merge" ? clone(current ?? {}) : {}, data) as Data;
    }
    next.set(path, doc);
  }
  stored = next;
}

type QueryState = {
  collection: string;
  filters: [string, string, unknown][];
  orders: [string, "asc" | "desc"][];
  max?: number;
  after?: string;
};

function run(query: QueryState) {
  let docs = [...stored.keys()]
    .filter((path) => path.startsWith(`${query.collection}/`))
    .map(snapshot)
    .filter((doc) =>
      query.filters.every(([field, op, value]) =>
        passes(at(doc.data(), field), op, value),
      ),
    )
    // Firestore leaves out a document without a field it orders by.
    .filter((doc) =>
      query.orders.every(([field]) => at(doc.data(), field) !== undefined),
    );
  docs.sort((a, b) => {
    for (const [field, dir] of query.orders) {
      const c = order(at(a.data(), field), at(b.data(), field));
      if (c !== 0) return dir === "asc" ? c : -c;
    }
    return a.id.localeCompare(b.id);
  });
  if (query.after !== undefined) {
    docs = docs.slice(docs.findIndex((doc) => doc.id === query.after) + 1);
  }
  if (query.max !== undefined) docs = docs.slice(0, query.max);
  return { docs, size: docs.length, empty: docs.length === 0 };
}

class FakeQuery {
  constructor(readonly state: QueryState) {}
  where(field: string, op: string, value: unknown) {
    return new FakeQuery({
      ...this.state,
      filters: [...this.state.filters, [field, op, value]],
    });
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc") {
    return new FakeQuery({
      ...this.state,
      orders: [...this.state.orders, [field, dir]],
    });
  }
  limit(max: number) {
    return new FakeQuery({ ...this.state, max });
  }
  startAfter(doc: { id: string }) {
    return new FakeQuery({ ...this.state, after: doc.id });
  }
  /** Every field comes back. */
  select() {
    return this;
  }
  async get() {
    return run(this.state);
  }
  count() {
    return {
      get: async () => {
        const { size } = run(this.state);
        return { data: () => ({ count: size }) };
      },
    };
  }
}

class FakeCollection extends FakeQuery {
  constructor(name: string) {
    super({ collection: name, filters: [], orders: [] });
  }
  doc(id: string) {
    return new FakeDocRef(this.state.collection, id);
  }
}

function writer() {
  const pending: Write[] = [];
  return {
    pending,
    set: (ref: FakeDocRef, data: Data, options?: { merge?: boolean }) => {
      pending.push([ref.path, options?.merge ? "merge" : "set", data]);
    },
    update: (ref: FakeDocRef, data: Data) => {
      pending.push([ref.path, "update", data]);
    },
    delete: (ref: FakeDocRef) => {
      pending.push([ref.path, "delete", {}]);
    },
  };
}

const db = {
  collection: (name: string) => new FakeCollection(name),
  // A field mask, last, is read as every field.
  getAll: async (...refs: unknown[]) =>
    refs
      .filter((ref): ref is FakeDocRef => ref instanceof FakeDocRef)
      .map((ref) => snapshot(ref.path)),
  batch: () => {
    const batch = writer();
    return { ...batch, commit: async () => commit(batch.pending) };
  },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const tx = writer();
    const result = await fn({
      ...tx,
      get: async (target: FakeDocRef | FakeQuery) => {
        // As Firestore has it: a transaction reads before it writes.
        if (tx.pending.length > 0) throw new Error("read after write");
        return target instanceof FakeQuery
          ? run(target.state)
          : snapshot(target.path);
      },
    });
    commit(tx.pending);
    return result;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firestore = db as any;

function put(path: string, data: Data) {
  stored.set(path, data);
}

function read(path: string): Data | undefined {
  return stored.get(path);
}

/** Every document, as text: what a second upload must leave as it was. */
function state(): string {
  return JSON.stringify([...stored.entries()]);
}

// ---------------------------------------------------------------------------
// The world: Anna Kowalska, a draft councillor of gmina Strzelin, whose 2023
// declaration's birth date readers agreed on and matched to her page.
// ---------------------------------------------------------------------------

const SHA = "a".repeat(64);
const ITEM = `${SHA}-p0`;
const CROP = `declarationExtracts/${ITEM}`;
const PICTURES = `declarationExtractImages/${ITEM}-employer`;
const DATE_PICTURE = `declarationExtractImages/${ITEM}`;
const STATS = "stats/declaration_employment";
const HASH = "c".repeat(64);
const NEW_HASH = "e".repeat(64);
const REGON = "123456785";

/** A PNG header with a size, which is all the endpoint looks at. */
function png(width: number, height: number, padding = 0): string {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return Buffer.from(bytes).toString("base64");
}

/** Her date crop: what the date flow keeps on the document the bands go
 * on. */
function crop(fields: Data = {}) {
  put(CROP, {
    id: ITEM,
    sha256: SHA,
    page: 0,
    url: "https://bip.strzelin.pl/download/1",
    status: "agreed",
    agreed: { value: "1979-07-15", kind: "date", by: "readers", readers: 2 },
    answerCount: 2,
    answers: { readings: { "1979-07-15": 2 }, unreadable: 0, empty: 0 },
    priority: 0,
    rand: 0.25,
    imageHash: "d".repeat(64),
    personIds: ["kowalska"],
    units: [
      {
        teryt: "021704",
        unitName: "Strzelin (gmina miejsko-wiejska)",
        level: "gmina",
        office: "Rada gminy",
        year: 2024,
      },
    ],
    pageMatch: "same",
    pageOutcomes: { kowalska: "queued" },
    pageRecheck: false,
    updatedAt: new FakeTimestamp(Date.parse("2026-11-01T10:00:00Z")),
    ...fields,
  });
  put(DATE_PICTURE, { date: Buffer.from(png(951, 105), "base64") });
}

/** One declaration's header and employer line, printed. */
function item(fields: Data = {}, employer: Data = {}) {
  return {
    id: ITEM,
    cutVersion: 1,
    header: {
      typed: true,
      strips: [{ page: 0, png: png(1654, 420) }],
      asOf: { value: "2023-12-31", score: 0.97 },
      filedOn: { value: "2024-04-28", score: 0.91 },
    },
    employer: {
      typed: true,
      strips: [{ page: 0, png: png(1654, 180) }],
      lines: [{ strip: 0, top: 12, bottom: 64 }],
      imageHash: HASH,
      suggestions: [{ employer: { regon: REGON }, role: "wicestarosta" }],
      ...employer,
    },
    ...fields,
  };
}

async function send(payload: Data) {
  mocks.body = { tag: "bip-declarations-employment-1", ...payload };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await handler({} as any)) as any;
}

/** The employer band's map on her crop. */
const band = () => read(CROP)!.employment as Data;

/** Her crop as the date flow keeps it: everything but the bands. */
function dateFields() {
  const { employment, employmentVii, employmentViii, ...rest } = read(CROP)!;
  void [employment, employmentVii, employmentViii];
  return JSON.stringify(rest);
}

beforeEach(() => {
  stored = new Map();
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    uid: "pipeline-bip-declarations",
    datascience: true,
  });
  put("nodes/kowalska", {
    type: "person",
    name: "Anna Kowalska",
    birthDate: "1979-07-15",
    published: false,
  });
  crop();
});

// ---------------------------------------------------------------------------

describe("api/ingest/declarations/employment", () => {
  it("refuses a caller outside the datascience group before reading the body", async () => {
    mocks.getUser.mockResolvedValueOnce({ uid: "reader" });
    const before = state();

    await expect(send({ items: [item()] })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.readBody).not.toHaveBeenCalled();
    expect(state()).toBe(before);
  });

  it("keeps the band on her date page beside the date, and its pictures apart", async () => {
    const date = dateFields();

    const result = await send({ runId: "run-7", items: [item()] });

    expect(result).toEqual({
      status: "ok",
      bands: { created: 1, updated: 0, kept: 0, unchanged: 0 },
      skipped: [],
    });
    expect(band()).toEqual({
      status: "open",
      closedFrom: null,
      personId: "kowalska",
      // A draft without a paid public post, not held for it.
      priority: 1,
      rand: expect.any(Number),
      answerCount: 0,
      typed: true,
      machine: {
        suggestions: [{ employer: { regon: REGON }, role: "wicestarosta" }],
        asOf: { value: "2023-12-31", score: 0.97 },
        filedOn: { value: "2024-04-28", score: 0.91 },
      },
      imageHash: HASH,
      cutVersion: 1,
      summary: null,
      agreed: null,
      decision: null,
      applyState: null,
      skipReason: null,
      applied: null,
      plan: null,
      control: null,
      flags: {},
      updatedAt: FakeTimestamp.now(),
    });
    // Not one of the date's fields moved.
    expect(dateFields()).toBe(date);

    const pictures = read(PICTURES)!;
    expect(pictures).toMatchObject({
      header: {
        typed: true,
        strips: [{ page: 0, width: 1654, height: 420 }],
        lines: [],
      },
      strips: [{ page: 0, width: 1654, height: 180 }],
      lines: [{ strip: 0, top: 12, bottom: 64 }],
      imageHash: HASH,
      cutVersion: 1,
      tag: "bip-declarations-employment-1",
      runId: "run-7",
      uploaderUid: "pipeline-bip-declarations",
    });
    const strips = pictures.strips as { png: unknown }[];
    expect(strips[0]!.png).toBeInstanceOf(Buffer);
    // The date's own picture is left as it was.
    expect(read(DATE_PICTURE)!.date).toBeInstanceOf(Buffer);
    expect(read(STATS)).toMatchObject({ employer: { open: 1 } });
  });

  it("keeps each band in a map and a picture document of its own", async () => {
    await send({
      items: [
        item({
          vii: {
            typed: false,
            strips: [
              { page: 1, png: png(2480, 300) },
              { page: 2, png: png(2480, 120) },
            ],
            lines: [{ strip: 1, top: 0, bottom: 60 }],
            imageHash: NEW_HASH,
          },
        }),
      ],
    });

    expect(read(CROP)!.employmentVii).toMatchObject({
      status: "open",
      typed: false,
      // Handwriting: no machine reading at all.
      machine: null,
      imageHash: NEW_HASH,
    });
    expect(read(`declarationExtractImages/${ITEM}-vii`)).toMatchObject({
      strips: [{ page: 1 }, { page: 2 }],
      imageHash: NEW_HASH,
    });
    expect(read(STATS)).toMatchObject({
      employer: { open: 1 },
      vii: { open: 1 },
    });
  });

  it("refuses an item whose date page the site does not have, and makes none", async () => {
    const other = `${"b".repeat(64)}-p3`;

    const result = await send({ items: [item({ id: other }), item()] });

    expect(result.skipped).toEqual([{ id: other, reason: "unknown_extract" }]);
    expect(result.bands.created).toBe(1);
    expect(read(`declarationExtracts/${other}`)).toBeUndefined();
    expect(read(`declarationExtractImages/${other}-employer`)).toBeUndefined();
  });

  describe("limits", () => {
    it("takes at most 25 items a request", async () => {
      const before = state();
      await expect(
        send({
          items: Array.from({ length: 26 }, (_, page) =>
            item({ id: `${SHA}-p${page}` }),
          ),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(state()).toBe(before);
    });

    it("refuses a picture over 200 kB", async () => {
      await expect(
        send({
          items: [
            item({}, { strips: [{ page: 0, png: png(1654, 180, 210_000) }] }),
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("refuses a request with more than 8 MB of pictures", async () => {
      const big = png(1654, 2000, 190_000);
      const before = state();
      await expect(
        send({
          items: Array.from({ length: 25 }, (_, page) =>
            item(
              {
                id: `${SHA}-p${page}`,
                header: { typed: true, strips: [{ page: 0, png: big }] },
              },
              { strips: [{ page: 0, png: big }] },
            ),
          ),
        }),
      ).rejects.toMatchObject({ statusCode: 413 });
      expect(state()).toBe(before);
    });

    it("skips a picture that is not a PNG", async () => {
      const result = await send({
        items: [
          item(
            {},
            {
              strips: [
                { page: 0, png: Buffer.from("GIF89a....").toString("base64") },
              ],
            },
          ),
        ],
      });
      expect(result.skipped).toEqual([{ id: ITEM, reason: "bad_image" }]);
      expect(band()).toBeUndefined();
      expect(read(PICTURES)).toBeUndefined();
    });

    it("skips a band whose pictures with the header's do not fit one document", async () => {
      const strip = { page: 0, png: png(2480, 1200, 190_000) };
      const result = await send({
        items: [
          item(
            {},
            { typed: false, suggestions: [], strips: Array(6).fill(strip) },
          ),
        ],
      });
      expect(result.skipped).toEqual([{ id: ITEM, reason: "too_large" }]);
      expect(read(PICTURES)).toBeUndefined();
    });
  });

  describe("sent again", () => {
    it("changes nothing when it comes as it was", async () => {
      await send({ items: [item()] });
      const before = state();

      const result = await send({ items: [item()] });

      expect(result.bands).toEqual({
        created: 0,
        updated: 0,
        kept: 0,
        unchanged: 1,
      });
      expect(state()).toBe(before);
    });

    it("replaces the picture and the machine's reading while no vote is on it", async () => {
      await send({ items: [item()] });
      const { rand } = band();

      const result = await send({
        items: [
          item(
            { cutVersion: 2 },
            {
              imageHash: NEW_HASH,
              strips: [{ page: 0, png: png(1654, 200) }],
              suggestions: [{ employer: { regon: REGON }, role: "starosta" }],
            },
          ),
        ],
      });

      expect(result.bands.updated).toBe(1);
      expect(band()).toMatchObject({
        status: "open",
        imageHash: NEW_HASH,
        cutVersion: 2,
        machine: { suggestions: [{ role: "starosta" }] },
        rand,
      });
      expect(read(PICTURES)).toMatchObject({
        imageHash: NEW_HASH,
        strips: [{ height: 200 }],
      });
      // Still one open band.
      expect(read(STATS)).toMatchObject({ employer: { open: 1 } });
    });

    it("keeps the picture a vote was cast on", async () => {
      await send({ items: [item()] });
      put(CROP, {
        ...read(CROP)!,
        employment: { ...band(), answerCount: 1 },
      });
      const before = band();

      const result = await send({
        items: [
          item(
            {},
            {
              imageHash: NEW_HASH,
              suggestions: [{ employer: { regon: REGON }, role: "starosta" }],
            },
          ),
        ],
      });

      expect(result.bands.kept).toBe(1);
      expect(band()).toEqual(before);
      expect(read(PICTURES)).toMatchObject({ imageHash: HASH });
    });

    it("takes a wider cut once readers asked for one, and the votes on the old picture go", async () => {
      await send({ items: [item()] });
      put(CROP, {
        ...read(CROP)!,
        employment: {
          ...band(),
          status: "recut",
          answerCount: 2,
          summary: { voices: 2, none: 0, unreadable: 0, rows: {}, asOf: {} },
          flags: { missing_part: 2, other_person: 1 },
        },
      });
      put(STATS, { employer: { recut: 1 } });

      // The same picture again is not the wider cut.
      expect((await send({ items: [item()] })).bands.unchanged).toBe(1);
      expect(band()).toMatchObject({ status: "recut" });

      await send({
        items: [
          item(
            { cutVersion: 2 },
            { imageHash: NEW_HASH, strips: [{ page: 0, png: png(1654, 260) }] },
          ),
        ],
      });

      expect(band()).toMatchObject({
        status: "open",
        answerCount: 0,
        summary: null,
        flags: { other_person: 1 },
        imageHash: NEW_HASH,
        cutVersion: 2,
      });
      expect(read(PICTURES)).toMatchObject({ imageHash: NEW_HASH });
      expect(read(STATS)).toMatchObject({ employer: { recut: 0, open: 1 } });
    });

    it("never puts back a picture an admin took off with its band", async () => {
      await send({ items: [item()] });
      put(CROP, {
        ...read(CROP)!,
        employment: { ...band(), status: "withdrawn" },
      });
      stored.delete(PICTURES);

      const result = await send({
        items: [item({}, { imageHash: NEW_HASH })],
      });

      expect(result.bands.kept).toBe(1);
      expect(band()).toMatchObject({ status: "withdrawn", imageHash: HASH });
      expect(read(PICTURES)).toBeUndefined();
    });

    it("opens an older declaration's band once it is no longer put off", async () => {
      await send({ items: [item({ later: true })] });
      expect(band()).toMatchObject({ status: "later", personId: "kowalska" });

      await send({ items: [item({ later: false })] });

      expect(band()).toMatchObject({ status: "open" });
      expect(read(STATS)).toMatchObject({ employer: { later: 0, open: 1 } });
    });
  });

  describe("whose declaration it is", () => {
    it.each([
      ["a date still read", { status: "open", agreed: null }],
      [
        "a year alone",
        { agreed: { value: "1979", kind: "year", by: "readers" } },
      ],
      ["a date not compared yet", { pageOutcomes: undefined, pageMatch: null }],
      ["a reading of another day", { pageOutcomes: { kowalska: "different" } }],
      [
        "two pages born that day",
        { pageOutcomes: { kowalska: "held", "kowalska-2": "held" } },
      ],
      [
        "a date an admin settled",
        {
          agreed: { value: "1979-07-15", kind: "date", by: "admin" },
          pageOutcomes: { kowalska: "held" },
        },
      ],
      ["a reading an admin took back", { status: "withdrawn" }],
    ])("waits on %s", async (_, fields) => {
      crop(fields);

      await send({ items: [item()] });

      expect(band()).toMatchObject({ status: "waiting", personId: null });
      expect(read(STATS)).toMatchObject({ employer: { waiting: 1 } });
    });

    it("waits when the one page it named is gone", async () => {
      put("nodes/kowalska", { ...read("nodes/kowalska")!, deleted: true });
      await send({ items: [item()] });
      expect(band()).toMatchObject({ status: "waiting", personId: null });
    });

    it("opens for a page public already, and for the page a merge kept", async () => {
      crop({ pageOutcomes: { kowalska: "confirmed", nowak: "different" } });
      await send({ items: [item()] });
      expect(band()).toMatchObject({ status: "open", personId: "kowalska" });

      stored.delete(CROP);
      crop({ pageOutcomes: { old: "queued" } });
      put("nodes/old", {
        type: "person",
        deleted: true,
        merged_into: "kowalska",
      });
      await send({ items: [item()] });
      expect(band()).toMatchObject({ status: "open", personId: "kowalska" });
    });

    it("puts off an older declaration even when it is hers", async () => {
      await send({ items: [item({ later: true })] });
      expect(band()).toMatchObject({ status: "later" });
      expect(read(STATS)).toMatchObject({ employer: { later: 1 } });
    });

    it("opens a waiting band once her date crop is matched to her page", async () => {
      crop({ status: "open", agreed: null, pageOutcomes: undefined });
      await send({ items: [item()] });
      expect(band()).toMatchObject({ status: "waiting" });

      // What `matchPages` leaves once readers agreed on her date.
      put(CROP, {
        ...read(CROP)!,
        status: "agreed",
        agreed: { value: "1979-07-15", kind: "date", by: "readers" },
        pageOutcomes: { kowalska: "queued" },
      });
      const moves = await openEmploymentOf(
        firestore,
        ITEM,
        new Date("2026-11-21T09:00:00Z"),
      );

      expect(moves).toEqual([
        { band: "employer", from: "waiting", to: "open" },
      ]);
      expect(band()).toMatchObject({
        status: "open",
        personId: "kowalska",
        priority: 1,
        updatedAt: FakeTimestamp.fromDate(new Date("2026-11-21T09:00:00Z")),
      });
      expect(read(STATS)).toMatchObject({ employer: { waiting: 0, open: 1 } });

      // Again: nothing to do.
      const before = state();
      expect(await openEmploymentOf(firestore, ITEM)).toEqual([]);
      expect(state()).toBe(before);
    });

    describe("when the crop no longer names her page", () => {
      /** A second page born that day: the comparison holds both. */
      const broken = { kowalska: "held", "kowalska-2": "held" };
      const hers = { kowalska: "queued" };
      const gate = (outcomes: Data) =>
        put(CROP, { ...read(CROP)!, pageOutcomes: outcomes });
      const withBand = (fields: Data) =>
        put(CROP, { ...read(CROP)!, employment: { ...band(), ...fields } });

      it("puts a band nobody voted on back to wait, and opens it with the gate", async () => {
        await send({ items: [item()] });

        gate(broken);
        await openEmploymentOf(firestore, ITEM);
        expect(band()).toMatchObject({
          status: "waiting",
          personId: null,
          closedFrom: null,
        });

        gate(hers);
        await openEmploymentOf(firestore, ITEM);
        expect(band()).toMatchObject({ status: "open", personId: "kowalska" });
      });

      it.each([
        ["an answered band", { status: "open", answerCount: 1 }],
        [
          "an agreed band nothing was written from",
          {
            status: "agreed",
            answerCount: 2,
            applyState: "planned",
            agreed: { rows: [], asOf: null, kind: null, readers: 2 },
          },
        ],
        ["an unreadable band", { status: "unreadable", answerCount: 3 }],
        ["a disputed band", { status: "disputed", answerCount: 6 }],
      ])(
        "closes %s with its answers, and puts it back when the gate passes again",
        async (_, fields) => {
          await send({ items: [item()] });
          withBand(fields);
          const kept = band();

          gate(broken);
          expect(await openEmploymentOf(firestore, ITEM)).toEqual([
            { band: "employer", from: fields.status, to: "closed" },
          ]);
          expect(band()).toEqual({
            ...kept,
            status: "closed",
            closedFrom: fields.status,
            updatedAt: expect.any(FakeTimestamp),
          });

          // Sent again while closed: its picture and answers stay.
          const result = await send({
            items: [item({}, { imageHash: NEW_HASH })],
          });
          expect(result.bands.kept).toBe(1);
          expect(band()).toMatchObject({ status: "closed", imageHash: HASH });

          gate(hers);
          expect(await openEmploymentOf(firestore, ITEM)).toEqual([
            { band: "employer", from: "closed", to: fields.status },
          ]);
          expect(band()).toEqual({
            ...kept,
            closedFrom: null,
            updatedAt: expect.any(FakeTimestamp),
          });
        },
      );

      it("leaves an admin's withdrawal and a written band as they are", async () => {
        await send({ items: [item()] });

        withBand({ status: "withdrawn", answerCount: 2 });
        for (const outcomes of [broken, hers]) {
          gate(outcomes);
          expect(await openEmploymentOf(firestore, ITEM)).toEqual([]);
          expect(band()).toMatchObject({ status: "withdrawn" });
        }

        // Written to the graph already: left for an admin.
        withBand({ status: "agreed", applyState: "applied" });
        gate(broken);
        expect(await openEmploymentOf(firestore, ITEM)).toEqual([]);
        expect(band()).toMatchObject({ status: "agreed" });
      });
    });
  });

  describe("the order it is read in", () => {
    const priority = async (world: () => void) => {
      world();
      await send({ items: [item()] });
      return band().priority;
    };

    it("puts a page held for want of a paid post first", async () => {
      expect(
        await priority(() =>
          put("declarationPublications/kowalska", {
            personId: "kowalska",
            status: "held",
            reason: "no_public_post",
          }),
        ),
      ).toBe(0);
    });

    it("leaves a hold an admin declined with the other drafts", async () => {
      expect(
        await priority(() =>
          put("declarationPublications/kowalska", {
            personId: "kowalska",
            status: "held",
            reason: "no_public_post",
            declinedAt: FakeTimestamp.now(),
          }),
        ),
      ).toBe(1);
    });

    it("puts a page with a paid public post last", async () => {
      expect(
        await priority(() => {
          put("nodes/wodociagi", {
            type: "place",
            name: "Wodociągi Strzelin",
            isPublic: true,
          });
          put("edges/kowalska-job", {
            type: "employed",
            name: "Zarząd",
            source: "kowalska",
            target: "wodociagi",
          });
        }),
      ).toBe(3);
    });

    it("puts a sitting mayor half a tier back", async () => {
      expect(
        await priority(() =>
          crop({
            units: [
              {
                teryt: "021704",
                level: "gmina",
                office: "Burmistrz",
                year: 2024,
              },
            ],
          }),
        ),
      ).toBe(1.5);
    });

    it("moves an open band when her page is published", async () => {
      await send({ items: [item()] });
      const { updatedAt } = band();
      put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });

      const result = await send({ items: [item()] });

      expect(result.bands.updated).toBe(1);
      // Where it is served from moved; nothing an admin looks at did.
      expect(band()).toMatchObject({ priority: 2, updatedAt });
    });
  });

  describe("the date flow", () => {
    const voter = (uid: string): DeclarationReader => ({
      uid,
      votes: true,
      anonymous: false,
    });
    const OPEN = `${"f".repeat(64)}-p0`;

    /** Her crop's date agreed and its band open; another crop's date still
     * read, with a band waiting on it. */
    async function both() {
      await send({ items: [item()] });
      put(`declarationExtracts/${OPEN}`, {
        status: "open",
        priority: 0,
        answerCount: 0,
        rand: 0.5,
        imageHash: "9".repeat(64),
        url: "https://bip.strzelin.pl/download/2",
        units: [
          { teryt: "021704", unitName: "Strzelin", office: "Rada gminy" },
        ],
        imageSize: { date: { width: 951, height: 105 }, name: null },
        personIds: ["nowak"],
      });
      put(`declarationExtractImages/${OPEN}`, {
        date: Buffer.from(png(951, 105), "base64"),
        name: null,
      });
      await send({ items: [item({ id: OPEN })] });
    }

    it("serves and counts crops by the date's own fields only", async () => {
      await both();
      expect(band()).toMatchObject({ status: "open", priority: 1 });

      const tasks = await nextTasks(firestore, "reader-1", 5);
      expect(tasks.map((task) => task.id)).toEqual([OPEN]);
      expect(tasks[0]!.images.date).toBe(
        `data:image/png;base64,${png(951, 105)}`,
      );

      const queue = await queueFor(firestore, "reader-1", 5);
      expect(queue).toMatchObject({ open: 1, settledCrops: 1 });
    });

    it("answers and settles a date without touching its band", async () => {
      await both();
      const waiting = () =>
        read(`declarationExtracts/${OPEN}`)!.employment as Data;
      const before = JSON.stringify(waiting());

      for (const uid of ["reader-1", "reader-2"]) {
        await recordAnswer(firestore, {
          extractId: OPEN,
          reader: voter(uid),
          answer: { verdict: "date", value: "1981-02-03" },
          now: new Date("2026-11-20T13:00:00Z"),
        });
      }

      expect(read(`declarationExtracts/${OPEN}`)).toMatchObject({
        status: "agreed",
        answerCount: 2,
        agreed: { value: "1981-02-03", by: "readers" },
      });
      expect(JSON.stringify(waiting())).toBe(before);
      expect(waiting()).toMatchObject({ status: "waiting", answerCount: 0 });
    });
  });

  it("keeps the pictures and the band's busy maps out of every index", () => {
    const file = existsSync(resolve(process.cwd(), "firestore.indexes.json"))
      ? resolve(process.cwd(), "firestore.indexes.json")
      : resolve(process.cwd(), "..", "firestore.indexes.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      indexes: {
        collectionGroup: string;
        fields: { fieldPath: string; order: string }[];
      }[];
      fieldOverrides: {
        collectionGroup: string;
        fieldPath: string;
        indexes: unknown[];
      }[];
    };
    const exempt = config.fieldOverrides
      .filter((field) => field.indexes.length === 0)
      .map((field) => `${field.collectionGroup}.${field.fieldPath}`);
    expect(exempt).toEqual(
      expect.arrayContaining([
        "declarationExtractImages.header",
        "declarationExtractImages.strips",
        "declarationExtractImages.lines",
        "declarationExtracts.employment.machine",
        "declarationExtracts.employment.summary",
        "declarationExtracts.employment.plan",
        "declarationExtracts.employment.applied",
        "edges.declared",
      ]),
    );
    const indexes = config.indexes
      .filter((index) => index.collectionGroup === "declarationExtracts")
      .map((index) =>
        index.fields.map((f) => `${f.fieldPath} ${f.order}`).join(", "),
      );
    // The queue the band is read from.
    expect(indexes).toContain(
      "employment.status ASCENDING, employment.priority ASCENDING, " +
        "employment.answerCount DESCENDING, employment.rand ASCENDING",
    );
    // The sweep's look at bands their placing missed.
    expect(indexes).toContain(
      "status ASCENDING, pageMatch ASCENDING, " +
        "employment.status ASCENDING, employment.rand ASCENDING",
    );
  });
});
