import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  drainPublications,
  inPeopleImportWindow,
  matchPages,
  publishPage,
  sweepDeclarations,
  STUCK_PUBLISHING_MS,
} from "../../../server/utils/declarationPublish";
import {
  DECLARATION_ACTOR,
  publishLimitOf,
} from "../../../shared/declarations";

/**
 * A Firestore double that runs everything the publication touches for real
 * over an in-memory map: the revision approval, the edge publication and the
 * audit rows come from the site's own helpers, not from mocks of them.
 * Queries filter (==, in, ranges, nested fields), order and limit the way
 * Firestore does - a document without an ordered field is left out - and a
 * batch or a transaction applies all of its writes or none.
 */
const { FakeTimestamp, DELETE, importRunning } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(readonly millis: number) {}
    static now() {
      return new FakeTimestamp(Date.now());
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
    isEqual(other: unknown) {
      return other instanceof FakeTimestamp && other.millis === this.millis;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  return {
    FakeTimestamp,
    DELETE: Symbol("delete"),
    importRunning: vi.fn(async (_now: Date) => false),
  };
});

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: FakeTimestamp,
  FieldValue: { delete: () => DELETE },
}));

// Whether a people import is running is read off the ops database's runs;
// each test says.
vi.mock("../../../server/utils/jobs", () => ({
  peopleImportRunning: importRunning,
}));

type Data = Record<string, unknown>;
let stored: Map<string, Data>;
let writes: number;
let autoId: number;

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
  if (op === "==") {
    return value instanceof FakeTimestamp
      ? value.isEqual(wanted)
      : value === wanted;
  }
  if (op === "in") return (wanted as unknown[]).includes(value);
  if (op === "array-contains") {
    return Array.isArray(value) && value.includes(wanted);
  }
  // Firestore leaves out a document without the field.
  if (value === undefined || value === null) return false;
  const c = order(value, wanted);
  if (op === "<") return c < 0;
  if (op === "<=") return c <= 0;
  if (op === ">") return c > 0;
  if (op === ">=") return c >= 0;
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
  get parent() {
    return { id: this.collection };
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

type Write = [string, "set" | "merge" | "update" | "create", Data];

function merged(before: unknown, after: unknown): unknown {
  if (after === DELETE) return undefined;
  if (isPlain(before) && isPlain(after)) {
    const out: Data = { ...before };
    for (const [key, value] of Object.entries(after)) {
      const next = merged(before[key], value);
      if (next === undefined) Reflect.deleteProperty(out, key);
      else out[key] = next;
    }
    return out;
  }
  return after;
}

/** Applies writes all together, or none if one of them fails. */
function commit(batch: readonly Write[]) {
  const next = new Map(stored);
  for (const [path, kind, data] of batch) {
    const current = next.get(path);
    if (kind === "update" && !current) throw new Error(`NOT_FOUND ${path}`);
    if (kind === "create" && current) throw new Error(`EXISTS ${path}`);
    let doc: Data;
    if (kind === "merge") {
      doc = merged(clone(current ?? {}), data) as Data;
    } else if (kind === "update") {
      doc = clone(current!);
      for (const [key, value] of Object.entries(data)) {
        const keys = key.split(".");
        let target = doc;
        for (const part of keys.slice(0, -1)) {
          if (!isPlain(target[part])) target[part] = {};
          target = target[part] as Data;
        }
        if (value === DELETE) Reflect.deleteProperty(target, keys.at(-1)!);
        else target[keys.at(-1)!] = value;
      }
    } else {
      doc = merged({}, data) as Data;
    }
    next.set(path, doc);
    writes += 1;
  }
  stored = next;
}

type QueryState = {
  collection: string;
  filters: [string, string, unknown][];
  orders: [string, "asc" | "desc"][];
  max?: number;
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
  async get() {
    return run(this.state);
  }
}

class FakeCollection extends FakeQuery {
  constructor(name: string) {
    super({ collection: name, filters: [], orders: [] });
  }
  doc(id?: string) {
    return new FakeDocRef(this.state.collection, id ?? `auto-${++autoId}`);
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
    create: (ref: FakeDocRef, data: Data) => {
      pending.push([ref.path, "create", data]);
    },
  };
}

const db = {
  collection: (name: string) => new FakeCollection(name),
  getAll: async (...refs: FakeDocRef[]) =>
    refs.map((ref) => snapshot(ref.path)),
  batch: () => {
    const batch = writer();
    return { ...batch, commit: async () => commit(batch.pending) };
  },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const tx = writer();
    const result = await fn({
      ...tx,
      get: async (target: FakeDocRef | FakeQuery) =>
        target instanceof FakeQuery ? run(target.state) : snapshot(target.path),
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

/** Every write, as text: what a second run must leave exactly as it was. */
function state(): string {
  return JSON.stringify([...stored.entries()]);
}

// ---------------------------------------------------------------------------
// The world: Anna Kowalska, a draft councillor of gmina Strzelin since 2024,
// whose 2023 declaration readers have read.
// ---------------------------------------------------------------------------

/** 13:00 in Warsaw: outside the people import's window. */
const NOON = new Date("2026-10-29T12:00:00Z");
/** Ten minutes later, when the next pass comes. */
const LATER = new Date("2026-10-29T12:10:00Z");
/** Long enough before NOON for a claim to count as a pass that died. */
const LONG_AGO = new Date(NOON.getTime() - 16 * 60_000);
const DAY = "2026-10-29";
const BORN = "1979-07-15";
const UNIT = {
  teryt: "021704",
  unitName: "Strzelin (gmina miejsko-wiejska)",
  level: "gmina",
  office: "Rada gminy",
  year: 2024,
};

function revision(nodeId: string, collection: string, data: Data) {
  return {
    node_id: nodeId,
    collection,
    data,
    status: "pending",
    update_user: "pipeline-people-import",
    update_automatic: true,
    update_time: "2026-10-01T02:00:00.000Z",
  };
}

/** A draft written by the people import: the page holds its revision. */
function person(id: string, page: Data = {}, content: Data = {}) {
  const data = {
    type: "person",
    name: "Anna Kowalska",
    birthDate: BORN,
    ...content,
  };
  put(`nodes/${id}`, { ...data, published: false, ...page });
  put(`revisions/rev-${id}`, revision(id, "nodes", data));
}

/** An edge the import wrote and nobody reviewed, holding its revision. */
function edge(id: string, data: Data, own: Data = {}) {
  put(`edges/${id}`, { ...data, published: false });
  put(`revisions/rev-${id}`, { ...revision(id, "edges", data), ...own });
}

function candidacy(id: string, source: string, fields: Data = {}) {
  edge(id, {
    type: "election",
    name: "kandydatura",
    source,
    target: "teryt0217",
    position: "Rada gminy",
    start_date: "2024-01-01",
    elected: true,
    ...fields,
  });
}

function job(id: string, source: string, company: string, fields: Data = {}) {
  edge(id, {
    type: "employed",
    name: "Rada Nadzorcza",
    source,
    target: company,
    start_date: "2020-03-01",
    ...fields,
  });
}

function extract(id: string, fields: Data = {}) {
  put(`declarationExtracts/${id}`, {
    status: "agreed",
    agreed: { value: BORN, kind: "date", by: "readers", readers: 2 },
    agreedName: null,
    personIds: ["kowalska"],
    units: [UNIT],
    url: `https://bip.strzelin.pl/download/${id}`,
    declarationYear: 2023,
    page: 1,
    pageMatch: null,
    ...fields,
  });
}

/** Her page, her 2024 run in Strzelin, a job at a public company, and her
 * crop - settled, not yet compared. */
function kowalska(id = "kowalska") {
  person(id);
  candidacy(`${id}-run`, id);
  job(`${id}-job`, id, "wodociagi");
  extract(`${id}-crop`, { personIds: [id] });
}

/** The same, queued for publication. */
async function queued(id = "kowalska") {
  kowalska(id);
  await matchPages(firestore, `${id}-crop`, NOON);
  expect(read(`declarationPublications/${id}`)).toMatchObject({
    status: "queued",
  });
}

const drain = (limit = 3, now = NOON) =>
  drainPublications(firestore, now, limit);

/** A reader's request, through /api/revisions/create, to take her page down:
 * the page's data with `deleted`, waiting for a reviewer. */
function removalRequest() {
  put("revisions/removal-by-reader", {
    ...revision("kowalska", "nodes", {
      type: "person",
      name: "Anna Kowalska",
      birthDate: BORN,
      deleted: true,
      delete_reason: "osoba prywatna",
    }),
    update_user: "reader-uid",
    update_automatic: false,
    update_time: "2026-10-20T10:00:00.000Z",
  });
}

/** Her page put up by a pass of this automation, as the audit log says. */
function upHere() {
  put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
  put("audit/ours", {
    action: "publish",
    collection: "nodes",
    target_id: "kowalska",
    user: DECLARATION_ACTOR,
    at: "2026-10-29T11:40:00.000Z",
  });
}

beforeEach(() => {
  stored = new Map();
  writes = 0;
  autoId = 0;
  importRunning.mockReset();
  importRunning.mockResolvedValue(false);
  for (const [id, name] of [
    ["teryt0217", "powiat strzeliński"],
    ["teryt0401", "powiat aleksandrowski"],
    ["teryt1465", "Warszawa"],
  ]) {
    put(`nodes/${id}`, { type: "region", name, published: true });
  }
  put("nodes/wodociagi", {
    type: "place",
    name: "Wodociągi Strzelin",
    published: true,
  });
  put("nodes/draftco", { type: "place", name: "Spółka X", published: false });
});

// Every approval and publication says so in the log.
vi.spyOn(console, "info").mockImplementation(() => {});

describe("matchPages", () => {
  it("queues a draft born on the day readers agreed on", async () => {
    kowalska();

    const result = await matchPages(firestore, "kowalska-crop", NOON);

    expect(result).toMatchObject({
      pageMatch: "same",
      outcomes: { kowalska: "queued" },
      changed: true,
    });
    expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
      pageMatch: "same",
      pageOutcomes: { kowalska: "queued" },
      // Nothing left for a later comparison to find.
      pageRecheck: false,
    });
    expect(read("declarationPublications/kowalska")).toMatchObject({
      personId: "kowalska",
      status: "queued",
      reason: null,
      extractIds: ["kowalska-crop"],
      declarations: [
        {
          url: "https://bip.strzelin.pl/download/kowalska-crop",
          year: 2023,
          unit: "Strzelin (gmina miejsko-wiejska)",
          office: "Rada gminy",
        },
      ],
    });
    // The page is not touched until a pass publishes it.
    expect(read("nodes/kowalska")!.published).toBe(false);
  });

  it("changes nothing when it runs again", async () => {
    kowalska();
    await matchPages(firestore, "kowalska-crop", NOON);
    const before = state();
    const counted = writes;

    const again = await matchPages(
      firestore,
      "kowalska-crop",
      new Date("2026-10-30T12:00:00Z"),
    );

    expect(again.changed).toBe(false);
    expect(writes).toBe(counted);
    expect(state()).toBe(before);
  });

  it("records a page without a birth date and does nothing else", async () => {
    kowalska();
    put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: "" });

    const result = await matchPages(firestore, "kowalska-crop", NOON);

    expect(result).toMatchObject({
      pageMatch: "no_date",
      outcomes: { kowalska: "no_date" },
    });
    expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
      pageRecheck: true,
    });
    expect(read("declarationPublications/kowalska")).toBeUndefined();
    expect(read(`notes/kowalska_${DECLARATION_ACTOR}`)).toBeUndefined();
  });

  it("flags another birth date with one note, however often it runs", async () => {
    kowalska();
    put("nodes/kowalska", {
      ...read("nodes/kowalska")!,
      birthDate: "1980-01-02",
    });

    const result = await matchPages(firestore, "kowalska-crop", NOON);
    await matchPages(firestore, "kowalska-crop", NOON);

    expect(result.pageMatch).toBe("different");
    const note = read(`notes/kowalska_${DECLARATION_ACTOR}`)!;
    expect(note).toMatchObject({
      userUid: DECLARATION_ACTOR,
      nodeId: "kowalska",
    });
    const entries = note.sources as Data[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "change_request",
      url: "https://bip.strzelin.pl/download/kowalska-crop",
      declarationExtractId: "kowalska-crop",
    });
    const text = entries[0]!.note as string;
    expect(text).toContain("Strzelin (gmina miejsko-wiejska)");
    expect(text).toContain("za 2023 r.");
    expect(text).toContain("strona 2 pliku");
    expect(text).toContain("Nic nie zostało zmienione ani odpięte");
    // Neither date, and hyphens only: no en or em dash.
    expect(text).not.toMatch(/1979|1980|[\u2013\u2014]/);
    // Nothing detached, nothing queued.
    expect(read("declarationPublications/kowalska")).toBeUndefined();
    expect(read("edges/kowalska-run")!.source).toBe("kowalska");
  });

  it("links the declaration on a page that is public already", async () => {
    kowalska();
    put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });

    const result = await matchPages(firestore, "kowalska-crop", NOON);

    expect(result.outcomes).toEqual({ kowalska: "confirmed" });
    expect(read("declarationPublications/kowalska")).toMatchObject({
      status: "confirmed",
      declarations: [{ year: 2023, office: "Rada gminy" }],
    });
  });

  it("holds both pages when two of them are born that day", async () => {
    kowalska();
    person("kowalska-2");
    extract("kowalska-crop", { personIds: ["kowalska", "kowalska-2"] });

    const result = await matchPages(firestore, "kowalska-crop", NOON);

    expect(result.outcomes).toEqual({
      kowalska: "held",
      "kowalska-2": "held",
    });
    for (const id of ["kowalska", "kowalska-2"]) {
      expect(read(`declarationPublications/${id}`)).toMatchObject({
        status: "held",
        reason: "two_pages",
        // Stamped as waiting, or the admin list of held pages, ordered by
        // it, would leave them out.
        queuedAt: FakeTimestamp.fromDate(NOON),
        heldAt: FakeTimestamp.fromDate(NOON),
      });
    }
    expect((await drain()).published).toEqual([]);
  });

  it("compares a merged page as the page it went into", async () => {
    kowalska();
    put("nodes/old", {
      type: "person",
      deleted: true,
      merged_into: "kowalska",
    });
    extract("kowalska-crop", { personIds: ["old"] });

    const result = await matchPages(firestore, "kowalska-crop", NOON);

    expect(result.outcomes).toEqual({ kowalska: "queued" });
  });

  it("compares nothing for a reading that is a year alone", async () => {
    kowalska();
    extract("kowalska-crop", {
      agreed: { value: "1979", kind: "year", by: "readers" },
    });

    const result = await matchPages(firestore, "kowalska-crop", NOON);

    expect(result).toEqual({
      extractId: "kowalska-crop",
      pageMatch: null,
      outcomes: {},
      changed: false,
    });
    expect(writes).toBe(0);
  });

  it("never writes the page's birth date onto the publication record", async () => {
    await queued();
    await drain();
    expect(
      JSON.stringify(read("declarationPublications/kowalska")),
    ).not.toMatch(/1979/);
  });
});

describe("publishing a queued page", () => {
  it("publishes the page, its candidacy and its KRS jobs, and nothing else", async () => {
    await queued();
    // A namesake's run in Warsaw, and a job at a company still in draft.
    put("nodes/teryt1465", {
      type: "region",
      name: "Warszawa",
      published: true,
    });
    candidacy("kowalska-warsaw", "kowalska", {
      target: "teryt1465",
      position: "Rada miasta",
      start_date: "2018-01-01",
    });
    job("kowalska-draft-job", "kowalska", "draftco");

    const result = await drain();

    expect(result).toMatchObject({
      skipped: null,
      published: ["kowalska"],
      held: [],
      capReached: false,
    });
    const page = read("nodes/kowalska")!;
    expect(page.published).toBe(true);
    expect(typeof page.content_changed_at).toBe("string");
    // The import's revision, approved by the automation on the way up.
    expect((page.revision_id as { path: string }).path).toBe(
      "revisions/rev-kowalska",
    );
    expect(read("revisions/rev-kowalska")).toMatchObject({
      status: "approved",
      review_user: DECLARATION_ACTOR,
    });
    const audit = [...stored.entries()]
      .filter(([path]) => path.startsWith("audit/"))
      .map(([, row]) => row);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "approve",
          target_id: "kowalska",
          user: DECLARATION_ACTOR,
        }),
        expect.objectContaining({
          action: "publish",
          collection: "nodes",
          target_id: "kowalska",
          user: DECLARATION_ACTOR,
        }),
      ]),
    );

    expect(read("edges/kowalska-run")).toMatchObject({ published: true });
    expect(read("revisions/rev-kowalska-run")).toMatchObject({
      status: "approved",
      review_user: DECLARATION_ACTOR,
    });
    expect(read("edges/kowalska-job")).toMatchObject({ published: true });
    expect(read("edges/kowalska-warsaw")!.published).toBe(false);
    expect(read("edges/kowalska-draft-job")!.published).toBe(false);

    expect(read("declarationPublications/kowalska")).toMatchObject({
      status: "published",
      autoPublished: true,
      day: DAY,
      approvedRevision: "rev-kowalska",
      edges: {
        published: ["kowalska-run", "kowalska-job"],
        held: [{ id: "kowalska-draft-job", reason: "company_draft" }],
      },
    });
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 1,
    });
  });

  it("leaves a job the import's rule would leave, and says why", async () => {
    await queued();
    job("kowalska-hand-job", "kowalska", "wodociagi", {
      start_date: "2021-01-01",
    });
    put("revisions/rev-kowalska-hand-job", {
      ...read("revisions/rev-kowalska-hand-job")!,
      update_automatic: false,
      update_user: "reader-uid",
    });

    await drain();

    expect(read("edges/kowalska-hand-job")!.published).toBe(false);
    expect(read("declarationPublications/kowalska")).toMatchObject({
      edges: { held: [{ id: "kowalska-hand-job", reason: "by_hand" }] },
    });
  });

  it("leaves the pipeline's committee proposal on the candidacy pending", async () => {
    await queued();
    put("revisions/proposal_kowalska-run_x", {
      ...revision("kowalska-run", "edges", {
        ...(read("revisions/rev-kowalska-run")!.data as Data),
        committee: "KWW Razem dla Strzelina",
      }),
      update_time: "2026-10-02T02:00:00.000Z",
    });

    const result = await drain();

    expect(result.published).toEqual(["kowalska"]);
    expect(read("edges/kowalska-run")).toMatchObject({ published: true });
    expect(read("revisions/proposal_kowalska-run_x")!.status).toBe("pending");
  });

  describe("holds the page", () => {
    async function holds(reason: string) {
      const result = await drain();
      expect(result.held).toEqual([{ personId: "kowalska", reason }]);
      expect(result.published).toEqual([]);
      expect(read("nodes/kowalska")!.published).toBe(false);
      expect(read("edges/kowalska-run")!.published).toBe(false);
      expect(read("edges/kowalska-job")!.published).toBe(false);
      expect(read("declarationPublications/kowalska")).toMatchObject({
        status: "held",
        reason,
      });
      // The slot is given back.
      expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
        count: 0,
      });
    }

    function edit(path: string, fields: Data) {
      put(path, { ...read(path)!, ...fields });
    }

    it("marked as two people", async () => {
      await queued();
      edit("nodes/kowalska", {
        needs_split: { reason: "dwie osoby", at: "", user: "admin" },
      });
      await holds("needs_split");
    });

    it("merged into another page since it was queued", async () => {
      await queued();
      edit("nodes/kowalska", { merged_into: "other", deleted: true });
      await holds("needs_split");
    });

    it("approved and kept hidden by an admin", async () => {
      await queued();
      edit("revisions/rev-kowalska", {
        status: "approved",
        review_user: "admin-uid",
      });
      edit("nodes/kowalska", {
        revision_id: new FakeDocRef("revisions", "rev-kowalska"),
      });
      await holds("kept_hidden");
    });

    it("taken off the site before", async () => {
      await queued();
      put("audit/earlier", {
        action: "unpublish",
        collection: "nodes",
        target_id: "kowalska",
        user: "admin-uid",
        at: "2026-10-01T10:00:00.000Z",
      });
      await holds("kept_hidden");
    });

    it("whose newest revision is a person's proposal", async () => {
      await queued();
      put("revisions/proposal-by-reader", {
        ...revision("kowalska", "nodes", {
          type: "person",
          name: "Anna Kowalska-Nowak",
          birthDate: BORN,
        }),
        update_user: "reader-uid",
        update_automatic: false,
        update_time: "2026-10-20T10:00:00.000Z",
      });
      await holds("pending_proposal");
    });

    it("with a person's proposal filed after this automation approved it", async () => {
      await queued();
      // A pass approved the import's revision and stopped before publishing.
      edit("revisions/rev-kowalska", {
        status: "approved",
        review_user: DECLARATION_ACTOR,
      });
      edit("nodes/kowalska", {
        revision_id: new FakeDocRef("revisions", "rev-kowalska"),
      });
      put("revisions/proposal-by-reader", {
        ...revision("kowalska", "nodes", {
          type: "person",
          name: "Anna Kowalska-Nowak",
          birthDate: BORN,
        }),
        update_user: "reader-uid",
        update_automatic: false,
        update_time: "2026-10-20T10:00:00.000Z",
      });
      await holds("pending_proposal");
    });

    it("with a reader's request to remove it waiting", async () => {
      await queued();
      // Never a revision the page would go up with, so never the newest one
      // `latestPublishableRevision` names.
      removalRequest();
      await holds("pending_proposal");
      expect(read("revisions/removal-by-reader")!.status).toBe("pending");
    });

    it("with a person's correction older than the import's newest revision", async () => {
      await queued();
      put("revisions/proposal-by-reader", {
        ...revision("kowalska", "nodes", {
          type: "person",
          name: "Anna Kowalska-Nowak",
          birthDate: BORN,
        }),
        update_user: "reader-uid",
        update_automatic: false,
        update_time: "2026-10-05T10:00:00.000Z",
      });
      // The import wrote over the page since, knowing nothing of it.
      edit("revisions/rev-kowalska", {
        update_time: "2026-10-10T02:00:00.000Z",
      });
      await holds("pending_proposal");
    });

    it("whose newest revision a reviewer turned down", async () => {
      await queued();
      // The page holds the import's newest revision, which an admin rejected;
      // an older one of the import's says the same birth date.
      edit("nodes/kowalska", { parties: ["PiS"] });
      edit("revisions/rev-kowalska", {
        data: {
          type: "person",
          name: "Anna Kowalska",
          birthDate: BORN,
          parties: ["PiS"],
        },
        update_time: "2026-10-10T02:00:00.000Z",
        status: "rejected",
        review_user: "admin-uid",
        reject_reason: "to nie ta osoba",
      });
      put(
        "revisions/rev-kowalska-old",
        revision("kowalska", "nodes", {
          type: "person",
          name: "Anna Kowalska",
          birthDate: BORN,
        }),
      );
      await holds("revision_rejected");
      expect(read("revisions/rev-kowalska-old")!.status).toBe("pending");
      expect(read("nodes/kowalska")!.parties).toEqual(["PiS"]);
    });

    it("that no longer shows its newest revision", async () => {
      await queued();
      // Written over outside a revision: approving the revision would take
      // this off the page on its way up.
      edit("nodes/kowalska", {
        wikipedia: "https://pl.wikipedia.org/wiki/Anna_Kowalska",
      });
      await holds("no_revision");
    });

    it("with no revision to approve", async () => {
      await queued();
      stored.delete("revisions/rev-kowalska");
      await holds("no_revision");
    });

    it("whose revision says another birth date", async () => {
      await queued();
      edit("revisions/rev-kowalska", {
        data: {
          type: "person",
          name: "Anna Kowalska",
          birthDate: "1980-01-02",
        },
      });
      await holds("no_revision");
    });

    it("whose birth date changed while it waited", async () => {
      await queued();
      edit("nodes/kowalska", { birthDate: "1980-01-02" });
      await holds("no_longer_matches");
    });

    it("where readers agreed on another name", async () => {
      kowalska();
      edit("declarationExtracts/kowalska-crop", { agreedName: "Jan Nowak" });
      await matchPages(firestore, "kowalska-crop", NOON);
      await holds("name_differs");
    });

    it("without the candidacy the declaration was filed for", async () => {
      await queued();
      edit("edges/kowalska-run", { start_date: "2018-01-01" });
      await holds("no_candidacy_on_page");
    });

    it("with two candidacies that could be it", async () => {
      await queued();
      candidacy("kowalska-run-2", "kowalska", { position: "Samorząd" });
      await holds("ambiguous_candidacy");
    });

    it("whose candidacy a reviewer rejected", async () => {
      await queued();
      put("revisions/rejected", {
        ...revision("kowalska-run", "edges", {}),
        status: "rejected",
        update_time: "2026-10-03T02:00:00.000Z",
      });
      await holds("candidacy_reviewed");
    });

    it("whose candidacy has a person's correction waiting", async () => {
      await queued();
      put("revisions/proposal-by-reader", {
        ...revision("kowalska-run", "edges", { elected: false }),
        update_user: "reader-uid",
        update_automatic: false,
        update_time: "2026-10-03T02:00:00.000Z",
      });
      await holds("candidacy_reviewed");
    });

    it("whose draft candidacies stand in two places in one election", async () => {
      await queued();
      // A namesake's run in another powiat in the same local election,
      // attached as every uncontradicted PKW record is.
      candidacy("kowalska-namesake", "kowalska", { target: "teryt0401" });
      await holds("two_places");
      expect(read("edges/kowalska-namesake")!.published).toBe(false);
    });

    it("with another declaration of hers read as another birth date", async () => {
      await queued();
      extract("kowalska-crop-2", {
        agreed: { value: "1981-02-03", kind: "date", by: "readers" },
        declarationYear: 2022,
      });
      await matchPages(firestore, "kowalska-crop-2", NOON);
      expect(read(`notes/kowalska_${DECLARATION_ACTOR}`)).toBeDefined();
      await holds("conflicting_reading");
    });

    it("once another page the crop names has the date too", async () => {
      kowalska();
      person("kowalska-2", {}, { birthDate: "" });
      edit("declarationExtracts/kowalska-crop", {
        personIds: ["kowalska", "kowalska-2"],
      });
      await matchPages(firestore, "kowalska-crop", NOON);
      expect(read("declarationPublications/kowalska")!.status).toBe("queued");
      // The import brings the second page the same date, and the crop has
      // not been compared again yet.
      edit("nodes/kowalska-2", { birthDate: BORN });
      await holds("two_pages");
    });

    it("that would stand in two places in one election", async () => {
      kowalska();
      // The same crop filed for a council in another powiat, in the same
      // local election.
      edit("declarationExtracts/kowalska-crop", {
        units: [
          UNIT,
          { ...UNIT, teryt: "040100", level: "powiat", office: "Rada powiatu" },
        ],
      });
      candidacy("kowalska-run-2", "kowalska", {
        target: "teryt0401",
        position: "Rada powiatu",
      });
      await matchPages(firestore, "kowalska-crop", NOON);
      await holds("two_places");
    });
  });

  it("publishes a page the import approved and left a draft", async () => {
    await queued();
    // `autoapprove` approves the import's revision without publishing the
    // page: nobody decided to keep it hidden.
    put("revisions/rev-kowalska", {
      ...read("revisions/rev-kowalska")!,
      status: "approved",
      review_user: "pipeline-people-import",
    });
    put("nodes/kowalska", {
      ...read("nodes/kowalska")!,
      revision_id: new FakeDocRef("revisions", "rev-kowalska"),
    });

    const result = await drain();

    expect(result.published).toEqual(["kowalska"]);
    // Approved already, so nothing is approved again.
    expect(read("declarationPublications/kowalska")).toMatchObject({
      approvedRevision: null,
    });
  });

  it("is not held for a request to remove her a reviewer turned down", async () => {
    await queued();
    removalRequest();
    put("revisions/removal-by-reader", {
      ...read("revisions/removal-by-reader")!,
      status: "rejected",
      review_user: "admin-uid",
      reject_reason: "osoba publiczna",
    });

    const result = await drain();

    expect(result.published).toEqual(["kowalska"]);
  });

  it("is not held for a namesake's run a reviewer rejected", async () => {
    await queued();
    candidacy("kowalska-namesake", "kowalska", { target: "teryt0401" });
    put("revisions/rev-kowalska-namesake", {
      ...read("revisions/rev-kowalska-namesake")!,
      status: "rejected",
      review_user: "admin-uid",
    });

    const result = await drain();

    expect(result.published).toEqual(["kowalska"]);
    expect(read("edges/kowalska-run")!.published).toBe(true);
    expect(read("edges/kowalska-namesake")!.published).toBe(false);
  });

  describe("her jobs, by where her birth date came from", () => {
    /** Her page linking register entry 123, as the import's revision does. */
    async function linked(link = "https://rejestr.io/osoby/123") {
      await queued();
      put("nodes/kowalska", { ...read("nodes/kowalska")!, rejestrIo: link });
      const own = read("revisions/rev-kowalska")!;
      put("revisions/rev-kowalska", {
        ...own,
        data: { ...(own.data as Data), rejestrIo: link },
      });
    }

    /** An older revision that carried the date first. */
    function first(fields: Data, data: Data = {}) {
      put("revisions/first", {
        ...revision("kowalska", "nodes", {
          type: "person",
          name: "Anna Kowalska",
          birthDate: BORN,
          rejestrIo: "https://rejestr.io/osoby/123",
          ...data,
        }),
        status: "approved",
        review_user: "pipeline-people-import",
        update_time: "2026-09-01T02:00:00.000Z",
        ...fields,
      });
    }

    it("publishes them where it came with the entry, however the link is spelled", async () => {
      await linked("https://rejestr.io/osoby/123/anna-kowalska");
      first({});

      const result = await drain();

      expect(result.published).toEqual(["kowalska"]);
      expect(read("edges/kowalska-job")!.published).toBe(true);
    });

    it("holds them where a person typed it", async () => {
      await linked();
      first({
        update_user: "editor-uid",
        update_automatic: false,
        review_user: "admin-uid",
      });

      const result = await drain();

      // The page and the candidacy the declaration is about go up.
      expect(result.published).toEqual(["kowalska"]);
      expect(read("edges/kowalska-run")!.published).toBe(true);
      expect(read("edges/kowalska-job")!.published).toBe(false);
      expect(read("declarationPublications/kowalska")).toMatchObject({
        edges: {
          published: ["kowalska-run"],
          held: [{ id: "kowalska-job", reason: "date_not_from_entry" }],
        },
      });
    });

    it("holds them where it came with another entry", async () => {
      await linked();
      first({}, { rejestrIo: "https://rejestr.io/osoby/999" });

      await drain();

      expect(read("edges/kowalska-job")!.published).toBe(false);
      expect(read("declarationPublications/kowalska")).toMatchObject({
        edges: {
          held: [{ id: "kowalska-job", reason: "date_not_from_entry" }],
        },
      });
    });
  });

  it("publishes a page this automation approved before a pass was cut short", async () => {
    await queued();
    put("revisions/rev-kowalska", {
      ...read("revisions/rev-kowalska")!,
      status: "approved",
      review_user: DECLARATION_ACTOR,
    });
    put("nodes/kowalska", {
      ...read("nodes/kowalska")!,
      revision_id: new FakeDocRef("revisions", "rev-kowalska"),
    });

    const result = await drain();

    expect(result.published).toEqual(["kowalska"]);
    expect(read("nodes/kowalska")!.published).toBe(true);
  });

  it("only links a page somebody published while it waited, and gives the slot back", async () => {
    await queued();
    put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
    put("audit/by-admin", {
      action: "publish",
      collection: "nodes",
      target_id: "kowalska",
      user: "admin-uid",
      at: "2026-10-29T11:00:00.000Z",
    });

    const result = await drain();

    expect(result.confirmed).toEqual(["kowalska"]);
    expect(read("edges/kowalska-run")!.published).toBe(false);
    expect(read("declarationPublications/kowalska")).toMatchObject({
      status: "confirmed",
    });
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 0,
    });
  });
});

describe("the daily limit", () => {
  it("publishes oldest first and stops at the limit", async () => {
    await queued("kowalska");
    await queued("nowak");
    // Queued first, so published first.
    put("declarationPublications/nowak", {
      ...read("declarationPublications/nowak")!,
      queuedAt: FakeTimestamp.fromDate(new Date("2026-10-28T12:00:00Z")),
    });

    const result = await drain(1);

    expect(result).toMatchObject({ published: ["nowak"], capReached: true });
    expect(read("declarationPublications/kowalska")!.status).toBe("queued");
    expect(read("nodes/kowalska")!.published).toBe(false);
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 1,
    });

    // The next day has slots again.
    const tomorrow = await drain(1, new Date("2026-10-30T12:00:00Z"));
    expect(tomorrow.published).toEqual(["kowalska"]);
  });

  it("publishes nothing at a limit of 0", async () => {
    await queued();
    const before = state();

    const result = await drain(0);

    expect(result).toMatchObject({ skipped: "off", published: [] });
    expect(state()).toBe(before);
  });

  it("gives a held page's slot to the next one in line", async () => {
    await queued("kowalska");
    await queued("nowak");
    put("nodes/kowalska", {
      ...read("nodes/kowalska")!,
      needs_split: { reason: "dwie osoby", at: "", user: "admin" },
    });
    put("declarationPublications/kowalska", {
      ...read("declarationPublications/kowalska")!,
      queuedAt: FakeTimestamp.fromDate(new Date("2026-10-28T12:00:00Z")),
    });

    const result = await drain(1);

    expect(result.held).toEqual([
      { personId: "kowalska", reason: "needs_split" },
    ]);
    expect(result.published).toEqual(["nowak"]);
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 1,
    });
  });

  it("publishes nothing while a people import is running", async () => {
    await queued();
    importRunning.mockResolvedValue(true);
    const before = state();

    const result = await drain();

    expect(result).toMatchObject({ skipped: "import", published: [] });
    expect(importRunning).toHaveBeenCalledWith(NOON);
    expect(state()).toBe(before);
  });

  it("publishes nothing when it cannot tell whether one is running", async () => {
    await queued();
    importRunning.mockRejectedValue(new Error("PERMISSION_DENIED"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const result = await drain();

    expect(result).toMatchObject({ skipped: "import", published: [] });
    expect(read("nodes/kowalska")!.published).toBe(false);
  });

  it("publishes nothing while the people import may be running", async () => {
    await queued();
    const before = state();

    // 03:00 and 08:59 in Warsaw are in the window.
    for (const now of ["2026-10-29T02:00:00Z", "2026-10-29T07:59:00Z"]) {
      const result = await drain(3, new Date(now));
      expect(result.skipped).toBe("night");
    }
    expect(state()).toBe(before);

    // 09:00 is not.
    const morning = await drain(3, new Date("2026-10-29T08:00:00Z"));
    expect(morning.published).toEqual(["kowalska"]);
  });
});

describe("a pass that was cut short", () => {
  /** Claimed at `claimedAt` by a pass that never finished, its slot taken. */
  async function stuck(claimedAt: Date) {
    await queued();
    put("declarationPublications/kowalska", {
      ...read("declarationPublications/kowalska")!,
      status: "publishing",
      claimedAt: FakeTimestamp.fromDate(claimedAt),
      day: DAY,
    });
    put(`declarationPublishLimits/${DAY}`, { day: DAY, count: 1 });
  }

  it("is taken up again under the slot it holds", async () => {
    await stuck(new Date(NOON.getTime() - STUCK_PUBLISHING_MS - 60_000));

    const result = await drain(1);

    expect(result.published).toEqual(["kowalska"]);
    expect(read("declarationPublications/kowalska")!.status).toBe("published");
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 1,
    });
  });

  it("is left alone while it may still be running", async () => {
    await stuck(new Date(NOON.getTime() - 5 * 60_000));

    const result = await drain(3);

    expect(result.published).toEqual([]);
    expect(read("declarationPublications/kowalska")!.status).toBe("publishing");
  });

  it("finishes the relations of a page it had put up already", async () => {
    await stuck(new Date(NOON.getTime() - STUCK_PUBLISHING_MS - 60_000));
    put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
    put("audit/ours", {
      action: "publish",
      collection: "nodes",
      target_id: "kowalska",
      user: DECLARATION_ACTOR,
      at: "2026-10-29T11:40:00.000Z",
    });

    const result = await drain(1);

    expect(result.published).toEqual(["kowalska"]);
    expect(read("edges/kowalska-run")!.published).toBe(true);
    expect(read("edges/kowalska-job")!.published).toBe(true);
  });

  it("leaves off a candidacy that stands in two places since the page went up", async () => {
    await stuck(LONG_AGO);
    upHere();
    candidacy("kowalska-namesake", "kowalska", { target: "teryt0401" });

    const result = await drain(1);

    expect(result.published).toEqual(["kowalska"]);
    expect(read("edges/kowalska-run")!.published).toBe(false);
    expect(read("edges/kowalska-job")!.published).toBe(true);
    expect(read("declarationPublications/kowalska")).toMatchObject({
      edges: {
        published: ["kowalska-job"],
        held: [{ id: "kowalska-run", reason: "two_places" }],
      },
    });
  });

  it("keeps the slot of a page it put up that was marked as two people since", async () => {
    await stuck(LONG_AGO);
    upHere();
    put("nodes/kowalska", {
      ...read("nodes/kowalska")!,
      needs_split: { reason: "dwie osoby", at: "", user: "admin" },
    });
    await queued("nowak");

    const result = await drain(1);

    // The page is up, so it went up under the day's one slot; nothing more
    // goes up with it, and the next page waits for tomorrow.
    expect(result).toMatchObject({
      published: ["kowalska"],
      held: [],
      capReached: true,
    });
    expect(read("declarationPublications/kowalska")).toMatchObject({
      status: "published",
      edges: {
        published: [],
        held: [
          { id: "kowalska-run", reason: "needs_split" },
          { id: "kowalska-job", reason: "needs_split" },
        ],
      },
    });
    expect(read("edges/kowalska-run")!.published).toBe(false);
    expect(read("declarationPublications/nowak")!.status).toBe("queued");
    expect(read("nodes/nowak")!.published).toBe(false);
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 1,
    });
  });

  it("finishes a page it put up even at a limit of 0", async () => {
    await stuck(LONG_AGO);
    upHere();

    const result = await drain(0);

    expect(result).toMatchObject({ skipped: "off", published: ["kowalska"] });
    expect(read("edges/kowalska-run")!.published).toBe(true);
    expect(read("edges/kowalska-job")!.published).toBe(true);
    expect(read("declarationPublications/kowalska")!.status).toBe("published");
  });

  it("leaves one it had not put up yet at a limit of 0", async () => {
    await stuck(LONG_AGO);
    const before = state();

    const result = await drain(0);

    expect(result).toMatchObject({ skipped: "off", published: [] });
    expect(state()).toBe(before);
  });

  it("gives no slot back once another pass has taken the page up", async () => {
    await stuck(LONG_AGO);
    put("nodes/kowalska", {
      ...read("nodes/kowalska")!,
      needs_split: { reason: "dwie osoby", at: "", user: "admin" },
    });
    // While this pass reads the page, a second one takes it up again.
    const getAll = db.getAll;
    db.getAll = async (...refs: FakeDocRef[]) => {
      db.getAll = getAll;
      put("declarationPublications/kowalska", {
        ...read("declarationPublications/kowalska")!,
        claimedAt: FakeTimestamp.fromDate(new Date(NOON.getTime() + 1_000)),
      });
      return getAll(...refs);
    };

    const result = await drain(1);

    expect(result.held).toEqual([
      { personId: "kowalska", reason: "needs_split" },
    ]);
    // The second pass's to finish: its record and its slot stay as they are.
    expect(read("declarationPublications/kowalska")!.status).toBe("publishing");
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 1,
    });
  });

  it("holds a page a second page with its date came to in the meantime", async () => {
    await stuck(LONG_AGO);
    person("kowalska-2");
    extract("crop-b", { personIds: ["kowalska", "kowalska-2"] });
    await matchPages(firestore, "crop-b", NOON);
    // Left for the pass that holds the slot, to hold the page and give the
    // slot back.
    expect(read("declarationPublications/kowalska")).toMatchObject({
      status: "publishing",
      reason: "two_pages",
    });
    expect(read("declarationPublications/kowalska-2")).toMatchObject({
      status: "held",
      reason: "two_pages",
    });

    const result = await drain(1);

    expect(result.held).toEqual([
      { personId: "kowalska", reason: "two_pages" },
    ]);
    expect(read("nodes/kowalska")!.published).toBe(false);
    expect(read("declarationPublications/kowalska")).toMatchObject({
      status: "held",
      reason: "two_pages",
    });
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 0,
    });
  });

  it("leaves off a candidacy a reviewer rejected after the page went up", async () => {
    await stuck(new Date(NOON.getTime() - STUCK_PUBLISHING_MS - 60_000));
    put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
    put("audit/ours", {
      action: "publish",
      collection: "nodes",
      target_id: "kowalska",
      user: DECLARATION_ACTOR,
      at: "2026-10-29T11:40:00.000Z",
    });
    put("revisions/rev-kowalska-run", {
      ...read("revisions/rev-kowalska-run")!,
      status: "rejected",
    });

    const result = await drain(1);

    expect(result.published).toEqual(["kowalska"]);
    expect(read("edges/kowalska-run")!.published).toBe(false);
    expect(read("revisions/rev-kowalska-run")!.status).toBe("rejected");
    expect(read("edges/kowalska-job")!.published).toBe(true);
    expect(read("declarationPublications/kowalska")).toMatchObject({
      edges: {
        published: ["kowalska-job"],
        held: [{ id: "kowalska-run", reason: "rejected" }],
      },
    });
  });
});

describe("sweepDeclarations", () => {
  it("compares the settled crops nothing has compared, and publishes", async () => {
    kowalska();

    const result = await sweepDeclarations(firestore, NOON, 1);

    expect(result).toMatchObject({ checked: 1, changed: 1 });
    expect(result.drain.published).toEqual(["kowalska"]);
  });

  it("compares again a crop whose page has a birth date since", async () => {
    kowalska();
    put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: "" });
    await matchPages(firestore, "kowalska-crop", NOON);
    // The nightly import brings the date.
    put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: BORN });

    const result = await sweepDeclarations(
      firestore,
      new Date("2026-10-30T12:00:00Z"),
      0,
    );

    expect(result.changed).toBe(1);
    expect(read("declarationExtracts/kowalska-crop")!.pageMatch).toBe("same");
    expect(read("declarationPublications/kowalska")!.status).toBe("queued");
  });

  it("holds both pages once the second one the crop names gains the date", async () => {
    kowalska();
    person("kowalska-2", {}, { birthDate: "" });
    put("declarationExtracts/kowalska-crop", {
      ...read("declarationExtracts/kowalska-crop")!,
      personIds: ["kowalska", "kowalska-2"],
    });
    await matchPages(firestore, "kowalska-crop", NOON);
    expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
      pageMatch: "same",
      pageRecheck: true,
    });
    put("nodes/kowalska-2", { ...read("nodes/kowalska-2")!, birthDate: BORN });

    const result = await sweepDeclarations(firestore, LATER, 3);

    expect(result).toMatchObject({ checked: 1, changed: 1 });
    expect(result.drain.published).toEqual([]);
    for (const id of ["kowalska", "kowalska-2"]) {
      expect(read(`declarationPublications/${id}`)).toMatchObject({
        status: "held",
        reason: "two_pages",
      });
    }
    expect(read("declarationExtracts/kowalska-crop")!.pageRecheck).toBe(false);
  });

  it("queues a page once its other birth date is corrected to the reading", async () => {
    kowalska();
    put("nodes/kowalska", {
      ...read("nodes/kowalska")!,
      birthDate: "1980-01-02",
    });
    await matchPages(firestore, "kowalska-crop", NOON);
    expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
      pageMatch: "different",
      pageRecheck: true,
    });
    put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: BORN });

    const result = await sweepDeclarations(firestore, LATER, 0);

    expect(result.changed).toBe(1);
    expect(read("declarationPublications/kowalska")!.status).toBe("queued");
  });

  it("sends a crop still without a date to the back of the line", async () => {
    kowalska();
    put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: "" });
    await matchPages(firestore, "kowalska-crop", NOON);
    const later = new Date("2026-10-30T12:00:00Z");

    const result = await sweepDeclarations(firestore, later, 0);

    expect(result).toMatchObject({ checked: 1, changed: 0 });
    expect(
      (
        read("declarationExtracts/kowalska-crop")!.pageCheckedAt as {
          millis: number;
        }
      ).millis,
    ).toBe(later.getTime());
  });
});

describe("a publication a stale write undid", () => {
  /** Published by a pass, then written back whole by an import request that
   * had read the page before it: what it learned, in a revision of its own,
   * with the visibility and the approval the page had then. */
  async function reverted() {
    await queued();
    await drain();
    expect(read("nodes/kowalska")!.published).toBe(true);
    const data = {
      type: "person",
      name: "Anna Kowalska",
      birthDate: BORN,
      wikipedia: "https://pl.wikipedia.org/wiki/Anna_Kowalska",
    };
    put("revisions/rev-kowalska-2", {
      ...revision("kowalska", "nodes", data),
      update_time: "2026-10-29T12:00:05.000Z",
    });
    put("nodes/kowalska", { ...data, published: false });
  }

  it("puts the page back up, under the slot it went up under", async () => {
    await reverted();

    const result = await sweepDeclarations(firestore, LATER, 3);

    expect(result.reverted).toEqual({ restored: ["kowalska"], held: [] });
    const page = read("nodes/kowalska")!;
    expect(page.published).toBe(true);
    expect((page.revision_id as { path: string }).path).toBe(
      "revisions/rev-kowalska-2",
    );
    expect(read("edges/kowalska-run")!.published).toBe(true);
    expect(read("declarationPublications/kowalska")).toMatchObject({
      status: "published",
      revertedAt: FakeTimestamp.fromDate(LATER),
      // What the first pass put up stays on the record.
      edges: { published: ["kowalska-run", "kowalska-job"] },
    });
    expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
      count: 1,
    });
  });

  it("takes the relations down with a page it may not put back", async () => {
    await reverted();
    removalRequest();

    const result = await sweepDeclarations(firestore, LATER, 3);

    expect(result.reverted).toEqual({
      restored: [],
      held: [{ personId: "kowalska", reason: "pending_proposal" }],
    });
    expect(read("nodes/kowalska")!.published).toBe(false);
    expect(read("edges/kowalska-run")!.published).toBe(false);
    expect(read("edges/kowalska-job")!.published).toBe(false);
    expect(read("declarationPublications/kowalska")).toMatchObject({
      status: "held",
      reason: "pending_proposal",
      revertedAt: FakeTimestamp.fromDate(LATER),
    });
  });

  it("waits while a people import is running", async () => {
    await reverted();
    importRunning.mockResolvedValue(true);

    const result = await sweepDeclarations(firestore, LATER, 3);

    expect(result.reverted).toEqual({ restored: [], held: [] });
    expect(read("nodes/kowalska")!.published).toBe(false);
  });

  it("leaves a page somebody took down", async () => {
    await queued();
    await drain();
    put("nodes/kowalska", { ...read("nodes/kowalska")!, published: false });
    put("audit/by-admin", {
      action: "unpublish",
      collection: "nodes",
      target_id: "kowalska",
      user: "admin-uid",
      at: "2099-01-01T00:00:00.000Z",
    });
    const before = state();

    const result = await sweepDeclarations(firestore, LATER, 3);

    expect(result.reverted).toEqual({ restored: [], held: [] });
    expect(state()).toBe(before);
  });
});

describe("publishLimitOf", () => {
  it("reads the limit as a whole number, and anything else as off", () => {
    expect(publishLimitOf({ declarationsDailyPublishLimit: 0 })).toBe(0);
    expect(publishLimitOf({})).toBe(0);
    // An environment override arrives as whatever destr made of the string.
    expect(publishLimitOf({ declarationsDailyPublishLimit: "10" })).toBe(10);
    expect(publishLimitOf({ declarationsDailyPublishLimit: 2.7 })).toBe(2);
    expect(publishLimitOf({ declarationsDailyPublishLimit: -1 })).toBe(0);
    expect(publishLimitOf({ declarationsDailyPublishLimit: "dużo" })).toBe(0);
  });
});

describe("inPeopleImportWindow", () => {
  it("is 03:00 to 09:00 on a Warsaw clock, in summer time too", () => {
    expect(inPeopleImportWindow(new Date("2026-10-29T01:59:00Z"))).toBe(false);
    expect(inPeopleImportWindow(new Date("2026-10-29T02:00:00Z"))).toBe(true);
    expect(inPeopleImportWindow(new Date("2026-10-29T08:00:00Z"))).toBe(false);
    // 03:30 in Warsaw is 01:30 UTC in July.
    expect(inPeopleImportWindow(new Date("2026-07-01T01:30:00Z"))).toBe(true);
    expect(inPeopleImportWindow(new Date("2026-07-01T07:00:00Z"))).toBe(false);
  });
});

describe("publishPage", () => {
  it("holds a page with nothing queued for it", async () => {
    kowalska();
    expect(await publishPage(firestore, "kowalska", NOON)).toEqual({
      status: "held",
      reason: "no_longer_matches",
    });
  });
});
