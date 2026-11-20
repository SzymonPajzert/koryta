import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEOPLE_DOC } from "../../../server/utils/declarationPeople";
import {
  countDeclarationPeople,
  DECLARATION_PEOPLE,
  refuseOlderFacts,
  restageCropPeople,
  restageDeclarationPeople,
  shardOf,
} from "../../../server/utils/declarationPeopleCount";
import type { PersonEntry } from "../../../shared/declarationPeople";
import {
  declarationPeopleSchema,
  type DeclarationFact,
  type DeclarationFactsIngest,
  type DeclarationPeople,
} from "../../../shared/declarations";

/**
 * The people count against a Firestore double over an in-memory map: the
 * reads the count makes (`getAll` with field masks, `select`, `in`,
 * `array-contains`, `array-contains-any`) and a transaction that writes all
 * or nothing. Which pages have a public post is the site's own
 * `pagesWithAPublicPost`, run for real.
 */
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
});

type Data = Record<string, unknown>;
let stored: Map<string, Data>;

class FakeTimestamp {
  constructor(readonly date: Date) {}
  toDate() {
    return this.date;
  }
}

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

/** The fields asked for, the way a field mask or `select` returns them. */
function project(data: Data, fields?: readonly string[]): Data {
  if (!fields) return clone(data);
  const out: Data = {};
  for (const field of fields) {
    const value = at(data, field);
    if (value === undefined) continue;
    const keys = field.split(".");
    let target = out;
    for (const key of keys.slice(0, -1)) {
      if (!isPlain(target[key])) target[key] = {};
      target = target[key] as Data;
    }
    target[keys.at(-1)!] = clone(value);
  }
  return out;
}

class FakeRef {
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
}

function snapshot(path: string, fields?: readonly string[]) {
  const data = stored.get(path);
  return {
    id: path.slice(path.indexOf("/") + 1),
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : project(data, fields)),
    get: (field: string) =>
      data === undefined ? undefined : at(project(data, fields), field),
  };
}

function passes(value: unknown, op: string, wanted: unknown): boolean {
  if (op === "==") return value === wanted;
  if (op === "in") return (wanted as unknown[]).includes(value);
  if (op === "array-contains") {
    return Array.isArray(value) && value.includes(wanted);
  }
  if (op === "array-contains-any") {
    return (
      Array.isArray(value) &&
      (wanted as unknown[]).some((each) => value.includes(each))
    );
  }
  throw new Error(`operator ${op}`);
}

class FakeQuery {
  constructor(
    readonly collection: string,
    readonly filters: [string, string, unknown][] = [],
    readonly fields?: readonly string[],
  ) {}
  where(field: string, op: string, value: unknown) {
    if (op === "in" || op === "array-contains-any") {
      // Firestore's cap.
      expect((value as unknown[]).length).toBeLessThanOrEqual(30);
    }
    return new FakeQuery(
      this.collection,
      [...this.filters, [field, op, value]],
      this.fields,
    );
  }
  select(...fields: string[]) {
    return new FakeQuery(this.collection, this.filters, fields);
  }
  async get() {
    const docs = [...stored.keys()]
      .filter((path) => path.startsWith(`${this.collection}/`))
      .sort()
      .filter((path) =>
        this.filters.every(([field, op, value]) =>
          passes(at(stored.get(path), field), op, value),
        ),
      )
      .map((path) => snapshot(path, this.fields));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeCollection extends FakeQuery {
  doc(id: string) {
    return new FakeRef(this.collection, id);
  }
}

const fake = {
  collection: (name: string) => new FakeCollection(name),
  getAll: async (...args: unknown[]) => {
    const options =
      args.at(-1) instanceof FakeRef
        ? undefined
        : (args.pop() as { fieldMask?: string[] });
    return (args as FakeRef[]).map((ref) =>
      snapshot(ref.path, options?.fieldMask),
    );
  },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const writes: [string, Data][] = [];
    const result = await fn({
      get: async (ref: FakeRef) => snapshot(ref.path),
      getAll: async (...refs: FakeRef[]) =>
        refs.map((ref) => snapshot(ref.path)),
      set: (ref: FakeRef, data: Data) => {
        writes.push([ref.path, clone(data)]);
      },
    });
    for (const [path, data] of writes) stored.set(path, data);
    return result;
  },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = fake as any;

const NOW = new Date("2026-11-17T06:15:00.000Z");
const LATER = new Date("2026-11-18T09:30:00.000Z");

const K = {
  jan: "a1a1a1a1",
  gone: "b2b2b2b2",
  anna: "c3c3c3c3",
  public: "d4d4d4d4",
  ewa: "e5e5e5e5",
  piotr: "f6f6f6f6",
  ola: "a7a7a7a7",
  done: "b8b8b8b8",
};

function fact(
  key: string,
  page: string,
  over: Partial<DeclarationFact> = {},
): DeclarationFact {
  return {
    key,
    kids: [page],
    teryt: "021704",
    unitName: "Testowo (gmina wiejska)",
    year: 2024,
    status: "found",
    reason: "named",
    uncut: false,
    cutNamed: false,
    waiting: false,
    bearers: 30_000,
    ...over,
  };
}

function body(over: Partial<DeclarationFactsIngest> = {}) {
  return {
    generation: "2026-11-17T05:40:00.000Z",
    listAt: "2026-11-17T04:10:00.000Z",
    part: "gs://koryta-pl-sharedcache/jobs/bip_declarations/facts/date=2026-11-17/2026-11-17T051500Z.jsonl.gz",
    partAt: "2026-11-17T05:15:00.000Z",
    candidacies: [
      // The list was built before his page was merged.
      fact(K.jan, "jan-old"),
      fact(K.gone, "gone"),
      fact(K.anna, "anna"),
      fact(K.public, "public"),
      fact(K.ewa, "ewa", { cutNamed: true, waiting: true }),
      fact(K.piotr, "piotr", { cutNamed: true }),
      fact(K.ola, "ola", { status: "not_found", reason: "captcha" }),
      fact(K.done, "done"),
    ],
    ...over,
  } satisfies DeclarationFactsIngest;
}

const PAID = ["jan", "public", "ewa", "piotr", "ola", "done"];

function world() {
  stored = new Map<string, Data>([
    ["nodes/jan-old", { type: "person", merged_into: "jan" }],
    ["nodes/jan", { type: "person", birthDate: " 1970-05-05 " }],
    // Nothing at a public company on her page.
    ["nodes/anna", { type: "person" }],
    ["nodes/public", { type: "person", published: true }],
    ["nodes/ewa", { type: "person" }],
    ["nodes/piotr", { type: "person" }],
    ["nodes/ola", { type: "person" }],
    ["nodes/done", { type: "person", published: true }],
    ["nodes/spolka", { type: "place", isPublic: true }],
    ...PAID.map((page): [string, Data] => [
      `edges/${page}-job`,
      { type: "employed", source: page, target: "spolka", name: "Prezes" },
    ]),
    ["declarationPublications/jan", { personId: "jan", status: "queued" }],
    [
      "declarationPublications/done",
      {
        personId: "done",
        status: "published",
        // 00:30 in Warsaw on the 17th.
        publishedAt: new FakeTimestamp(new Date("2026-11-16T23:30:00Z")),
      },
    ],
    // Settled before the merge: it names his page by the old id.
    [
      "declarationExtracts/x1",
      {
        status: "agreed",
        personIds: ["jan-old"],
        pageOutcomes: { "jan-old": "queued" },
        agreed: { value: "1970-05-05", kind: "date" },
        candidacyKeys: [K.jan],
      },
    ],
    // His name was read on another councillor's page.
    [
      "declarationExtracts/x2",
      { status: "open", personIds: ["kowalski"], candidacyKeys: [K.piotr] },
    ],
  ]);
}

/** Every entry the shards hold, by page, each checked to be in its shard. */
function entries(): Record<string, PersonEntry> {
  const all: Record<string, PersonEntry> = {};
  for (let i = 0; i < 8; i++) {
    const shard = stored.get(`${DECLARATION_PEOPLE}/shard-${i}`)?.entries as
      Record<string, PersonEntry> | undefined;
    for (const [page, entry] of Object.entries(shard ?? {})) {
      expect(shardOf(page)).toBe(i);
      all[page] = entry;
    }
  }
  return all;
}

const stages = () =>
  Object.fromEntries(
    Object.entries(entries()).map(([page, entry]) => [
      page,
      [entry.stage, entry.detail],
    ]),
  );

const snapshotOf = () =>
  declarationPeopleSchema.parse(
    stored.get(`stats/${PEOPLE_DOC}`),
  ) as DeclarationPeople;

beforeEach(() => {
  vi.clearAllMocks();
  world();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("countDeclarationPeople", () => {
  it("counts the list's people a declaration can publish, each in one stage", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await countDeclarationPeople(db, body(), NOW);

    expect(result).toEqual({
      status: "ok",
      people: 5,
      stages: {
        published: 1,
        namesakes: 0,
        mismatched: 0,
        held: 1,
        reading: 0,
        cropped: 1,
        downloaded: 0,
        searching: 2,
      },
      unknownReasons: { captcha: 1 },
    });
    // Gone, without a public post, and public some other way: left out.
    expect(stages()).toEqual({
      // His crop and his kid both name the page he was merged from.
      jan: ["held", "queued"],
      ewa: ["cropped", ""],
      piotr: ["searching", "other_page"],
      ola: ["searching", "pending"],
      done: ["published", ""],
    });
    expect(entries().jan).toEqual({
      stage: "held",
      detail: "queued",
      band: 4,
      publishedOn: null,
      unit: "021704",
      unitName: "Testowo (gmina wiejska)",
      keys: [K.jan],
      candidacies: [
        {
          key: K.jan,
          teryt: "021704",
          unitName: "Testowo (gmina wiejska)",
          year: 2024,
          status: "found",
          reason: "named",
          uncut: false,
          cutNamed: false,
          waiting: false,
        },
      ],
      at: NOW.getTime(),
    });
    expect(stored.get(`${DECLARATION_PEOPLE}/meta`)).toEqual({
      generation: "2026-11-17T05:40:00.000Z",
      listAt: "2026-11-17T04:10:00.000Z",
      part: body().part,
      partAt: "2026-11-17T05:15:00.000Z",
      countedAt: NOW.toISOString(),
      shards: 8,
    });
    expect(snapshotOf()).toMatchObject({
      at: NOW.toISOString(),
      exportDay: "2026-11-17",
      people: 5,
      publishedByDay: [{ day: "2026-11-17", count: 1 }],
    });
  });

  it("takes a crop that reached the site after predator's facts for the one they said waits", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    // Uploaded after the facts were written, and found unreadable since.
    stored.set("declarationExtracts/x4", {
      status: "unreadable",
      personIds: ["ewa"],
      candidacyKeys: [K.ewa],
      createdAt: new FakeTimestamp(new Date("2026-11-17T05:30:00Z")),
    });

    await countDeclarationPeople(db, body(), NOW);

    expect(stages().ewa).toEqual(["searching", "unreadable"]);
    // One the site had when they were written is not the one they meant.
    stored.set("declarationExtracts/x4", {
      ...stored.get("declarationExtracts/x4")!,
      createdAt: new FakeTimestamp(new Date("2026-11-17T05:00:00Z")),
    });
    await countDeclarationPeople(db, body(), NOW);
    expect(stages().ewa).toEqual(["cropped", ""]);
  });

  it("refuses facts older than the ones counted, unless forced", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    stored.set(`${DECLARATION_PEOPLE}/meta`, {
      generation: "2026-11-17T07:00:00.000Z",
    });

    await expect(refuseOlderFacts(db, body())).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(countDeclarationPeople(db, body(), NOW)).rejects.toMatchObject(
      { statusCode: 409 },
    );
    expect(stored.has(`stats/${PEOPLE_DOC}`)).toBe(false);

    await refuseOlderFacts(db, body({ force: true }));
    await countDeclarationPeople(db, body({ force: true }), NOW);
    expect(snapshotOf().people).toBe(5);
    // The same night sent again is counted again.
    await refuseOlderFacts(
      db,
      body({ generation: "2026-11-17T05:40:00.000Z" }),
    );
  });

  it("stages again a person an event moved while it read", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const shard = shardOf("ewa");
    stored.set(`${DECLARATION_PEOPLE}/meta`, {
      generation: "2026-11-16T05:40:00.000Z",
    });
    stored.set(`${DECLARATION_PEOPLE}/shard-${shard}`, {
      entries: {
        ewa: {
          stage: "reading",
          detail: "",
          band: 4,
          publishedOn: null,
          unit: "021704",
          unitName: "",
          keys: [K.ewa],
          candidacies: [
            {
              key: K.ewa,
              teryt: "021704",
              unitName: "",
              year: 2024,
              status: "found",
              reason: "named",
              uncut: false,
              cutNamed: true,
              waiting: false,
            },
          ],
          // Staged after the count began to read.
          at: NOW.getTime() + 1,
        },
      },
    });

    await countDeclarationPeople(db, body(), NOW);

    // Staged again from the night's candidacies, after the count.
    expect(entries().ewa).toMatchObject({
      stage: "cropped",
      at: NOW.getTime() + 60_000,
    });
    expect(entries().jan!.at).toBe(NOW.getTime());
  });

  it("keeps the entries out of every index", () => {
    const file = ["firestore.indexes.json", "../firestore.indexes.json"]
      .map((path) => resolve(process.cwd(), path))
      .find((path) => existsSync(path))!;
    const { fieldOverrides } = JSON.parse(readFileSync(file, "utf8")) as {
      fieldOverrides: unknown[];
    };

    expect(fieldOverrides).toContainEqual({
      collectionGroup: DECLARATION_PEOPLE,
      fieldPath: "entries",
      indexes: [],
    });
  });
});

describe("restageDeclarationPeople", () => {
  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await countDeclarationPeople(db, body(), NOW);
  });

  it("moves a page that went up to published, and the day's bar with it", async () => {
    stored.set("nodes/jan", { type: "person", published: true });
    stored.set("declarationPublications/jan", {
      personId: "jan",
      status: "published",
      publishedAt: new FakeTimestamp(LATER),
    });

    await restageDeclarationPeople(db, ["jan"], LATER);

    expect(entries().jan).toMatchObject({
      stage: "published",
      publishedOn: "2026-11-18",
      at: LATER.getTime(),
    });
    expect(snapshotOf()).toMatchObject({
      at: LATER.toISOString(),
      exportDay: "2026-11-18",
      people: 5,
      published: 2,
      held: 0,
      publishedByDay: [
        { day: "2026-11-17", count: 1 },
        { day: "2026-11-18", count: 1 },
      ],
    });
  });

  it("moves a person on as the crop predator said waits arrives and settles", async () => {
    stored.set("declarationExtracts/x4", {
      status: "open",
      personIds: ["ewa"],
      candidacyKeys: [K.ewa],
      createdAt: new FakeTimestamp(new Date("2026-11-18T08:00:00Z")),
    });
    await restageDeclarationPeople(db, ["ewa"], LATER);
    expect(stages().ewa).toEqual(["reading", ""]);

    stored.set("declarationExtracts/x4", {
      ...stored.get("declarationExtracts/x4")!,
      status: "unreadable",
    });
    await restageDeclarationPeople(db, ["ewa"], LATER);

    // Not back to cropped: the crop the facts said waits is this one.
    expect(stages().ewa).toEqual(["searching", "unreadable"]);
    expect(snapshotOf()).toMatchObject({ cropped: 0, reading: 0 });
  });

  it("keeps a page a declaration published under an id merged into it since", async () => {
    stored.set("nodes/done-old", { type: "person", merged_into: "done" });
    stored.set("declarationPublications/done-old", {
      ...stored.get("declarationPublications/done")!,
      personId: "done-old",
    });
    stored.delete("declarationPublications/done");
    await countDeclarationPeople(db, body(), NOW);
    expect(entries().done).toMatchObject({ stage: "published" });

    await restageDeclarationPeople(db, ["done"], LATER);

    expect(entries().done).toMatchObject({
      stage: "published",
      publishedOn: "2026-11-17",
    });
    expect(snapshotOf().people).toBe(5);
  });

  it("writes nothing while an entry does not read, as one a newer release wrote", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = ["zofia", "maria", "adam", "olga"].find(
      (id) => shardOf(id) !== shardOf("jan"),
    )!;
    const shard = `${DECLARATION_PEOPLE}/shard-${shardOf(page)}`;
    const held = entries().jan!;
    stored.set(shard, {
      entries: {
        ...(stored.get(shard)?.entries as Record<string, PersonEntry>),
        [page]: { ...held, stage: "queued" },
      },
    });
    stored.set("declarationPublications/jan", {
      personId: "jan",
      status: "published",
      publishedAt: new FakeTimestamp(LATER),
    });
    const before = JSON.stringify([...stored]);

    await restageDeclarationPeople(db, ["jan"], LATER);

    expect(JSON.stringify([...stored])).toBe(before);
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining("re-staging jan"),
      expect.objectContaining({
        message: expect.stringContaining("do not read"),
      }),
    );
  });

  it("drops a page made public some other way", async () => {
    stored.set("nodes/ewa", { type: "person", published: true });

    await restageDeclarationPeople(db, ["ewa"], LATER);

    expect(entries().ewa).toBeUndefined();
    expect(snapshotOf()).toMatchObject({ people: 4, cropped: 0 });
  });

  it("follows a page merged since, and drops the one merged away", async () => {
    stored.set("nodes/ewa", { type: "person", merged_into: "ola" });
    stored.set("declarationExtracts/x3", {
      status: "open",
      personIds: ["ola"],
      candidacyKeys: [K.ola],
    });

    await restageDeclarationPeople(db, ["ewa"], LATER);

    expect(stages()).toEqual({
      jan: ["held", "queued"],
      ola: ["reading", ""],
      piotr: ["searching", "other_page"],
      done: ["published", ""],
    });
  });

  it("moves the people of a crop an admin decided", async () => {
    // A decision leaves what the crop said of its pages as it was.
    stored.set("declarationExtracts/x1", {
      ...stored.get("declarationExtracts/x1")!,
      status: "withdrawn",
      agreed: null,
    });

    await restageCropPeople(db, ["x1"], [], LATER);

    expect(entries().jan).toMatchObject({
      stage: "searching",
      detail: "other_page",
    });
  });

  it("leaves alone a page it does not count, and a newer staging", async () => {
    const before = JSON.stringify([...stored]);
    await restageDeclarationPeople(db, ["anna", "nobody"], LATER);
    expect(JSON.stringify([...stored])).toBe(before);

    // Staged from reads later than these.
    const shard = `${DECLARATION_PEOPLE}/shard-${shardOf("jan")}`;
    const held = stored.get(shard)!.entries as Record<string, PersonEntry>;
    held.jan = { ...held.jan!, at: LATER.getTime() + 1 };
    stored.set("declarationPublications/jan", {
      personId: "jan",
      status: "published",
      publishedAt: new FakeTimestamp(LATER),
    });
    await restageDeclarationPeople(db, ["jan"], LATER);
    expect(entries().jan!.stage).toBe("held");
  });

  it("never fails its caller", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      ...fake,
      getAll: async () => {
        throw new Error("unavailable");
      },
    };

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      restageDeclarationPeople(broken as any, ["jan"], LATER),
    ).resolves.toBeUndefined();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      restageCropPeople(broken as any, ["x1"], ["jan"], LATER),
    ).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining("re-staging jan"),
      expect.any(Error),
    );
    expect(entries().jan!.stage).toBe("held");
  });
});
