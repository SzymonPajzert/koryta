import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../../server/api/ops/jobs.get";
import { requireOwner } from "../../../server/utils/auth";
import {
  COMPRESSED_BUCKET,
  captureRuns,
  clearProbeCache,
  compressedMirror,
  jobsOverview,
  latestFirestoreExport,
  reportedRuns,
} from "../../../server/utils/jobs";
import { JOBS, RUNS_SHOWN } from "../../../shared/jobs";
import type { JobView, ProbeResult } from "../../../shared/jobs";

type Doc = Record<string, unknown>;

const { Timestamp, mockGetFirestore, mockGetStorage, collections, objects } =
  vi.hoisted(() => {
    /** Enough of Firestore's Timestamp for the server to tell one apart. */
    class Timestamp {
      constructor(readonly millis: number) {}
      static fromDate(date: Date) {
        return new Timestamp(date.getTime());
      }
      toDate() {
        return new Date(this.millis);
      }
    }
    return {
      Timestamp,
      mockGetFirestore: vi.fn(),
      mockGetStorage: vi.fn(),
      /** `<database>/<collection>` -> document id -> data. */
      collections: new Map<string, Map<string, Record<string, unknown>>>(),
      /** Bucket -> object name -> its metadata. */
      objects: new Map<string, Map<string, Record<string, unknown>>>(),
    };
  });

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
}));

vi.mock("~~/server/utils/auth", () => ({
  requireOwner: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp,
  getFirestore: mockGetFirestore,
}));

vi.mock("firebase-admin/storage", () => ({
  getStorage: mockGetStorage,
}));

vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));

const OPS = "agent-tasks";
const SITE = "koryta-pl";
const CRAWLED = "koryta-pl-crawled";

const docsOf = (database: string, collection: string) => {
  const key = `${database}/${collection}`;
  if (!collections.has(key)) collections.set(key, new Map());
  return collections.get(key)!;
};

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

function compare(a: unknown, b: unknown): number {
  if (a instanceof Timestamp && b instanceof Timestamp) {
    return a.millis - b.millis;
  }
  return String(a).localeCompare(String(b));
}

/** The part of a Firestore query the server uses, over `collections`:
 * equality and lower-bound filters, one ordering (which, as in Firestore,
 * leaves out documents without the field), a limit, `get` and `count`. */
function fakeQuery(
  database: string,
  collection: string,
  failure: () => unknown,
  filters: ((doc: Doc) => boolean)[] = [],
  order: [string, "asc" | "desc"] | null = null,
  limit: number | null = null,
): unknown {
  const matching = () => {
    const error = failure();
    if (error) throw error;
    let docs = [...docsOf(database, collection)].filter(([, doc]) =>
      filters.every((filter) => filter(doc)),
    );
    if (order) {
      const [field, direction] = order;
      docs = docs
        .filter(([, doc]) => doc[field] !== undefined)
        .sort(
          ([, a], [, b]) =>
            compare(a[field], b[field]) * (direction === "desc" ? -1 : 1),
        );
    }
    return limit === null ? docs : docs.slice(0, limit);
  };
  const next = (
    more: Partial<{
      filter: (doc: Doc) => boolean;
      order: [string, "asc" | "desc"];
      limit: number;
    }>,
  ) =>
    fakeQuery(
      database,
      collection,
      failure,
      more.filter ? [...filters, more.filter] : filters,
      more.order ?? order,
      more.limit ?? limit,
    );
  return {
    where: (field: string, op: string, value: unknown) =>
      next({
        filter: (doc) =>
          op === "=="
            ? compare(doc[field], value) === 0 && doc[field] !== undefined
            : op === ">="
              ? doc[field] !== undefined && compare(doc[field], value) >= 0
              : (() => {
                  throw new Error(`fake query: no ${op}`);
                })(),
      }),
    orderBy: (field: string, direction: "asc" | "desc" = "asc") =>
      next({ order: [field, direction] }),
    limit: (count: number) => next({ limit: count }),
    get: async () => ({
      docs: matching().map(([id, data]) => ({ id, data: () => data })),
    }),
    count: () => ({
      get: async () => {
        counted.push({ collection, order });
        if (countFailure) throw countFailure;
        return { data: () => ({ count: matching().length }) };
      },
    }),
    doc: (id: string) => ({ id, collection }),
  };
}

/** Every count asked for, with the order it was asked in: the counts are
 * where a missing index would show, since the only one articlePages has is
 * (status ASC, capturedAt DESC). */
let counted: { collection: string; order: [string, "asc" | "desc"] | null }[];
/** What a test makes every count fail with, alone. */
let countFailure: unknown;

/** Per database: what a test makes it fail with, and its `getAll`. */
let failures: Map<string, unknown>;
let getAlls: Map<string, ReturnType<typeof vi.fn>>;

function fakeDb(database: string) {
  const getAll = vi.fn(async (...refs: { id: string; collection: string }[]) =>
    refs.map((ref) => {
      const data = docsOf(database, ref.collection).get(ref.id);
      return { id: ref.id, exists: data !== undefined, data: () => data };
    }),
  );
  getAlls.set(database, getAll);
  return {
    collection: (name: string) =>
      fakeQuery(database, name, () => failures.get(database)),
    getAll,
  };
}

/** A bucket as @google-cloud/storage answers for it. With `autoPaginate`
 * off, `getFiles` resolves `[files, nextQuery, apiResponse]` and the folders
 * a delimiter listing finds are only in the raw response's `prefixes`, which
 * the API leaves out when there are none. Left on, the paginator returns the
 * files alone - so a delimiter listing that forgot to turn it off would see
 * no folders here either. */
function fakeBucket(name: string) {
  const contents = () => objects.get(name) ?? new Map<string, Doc>();
  const file = (objectName: string) => ({
    name: objectName,
    metadata: contents().get(objectName) ?? {},
    getMetadata: vi.fn(async () => {
      const metadata = contents().get(objectName);
      if (!metadata) {
        throw Object.assign(new Error(`No such object: ${objectName}`), {
          code: 404,
        });
      }
      return [metadata];
    }),
  });
  return {
    getFiles: vi.fn(
      async (
        query: {
          prefix?: string;
          delimiter?: string;
          autoPaginate?: boolean;
        } = {},
      ) => {
        const error = failures.get(name);
        if (error) throw error;
        const prefix = query.prefix ?? "";
        const prefixes = new Set<string>();
        const items: string[] = [];
        for (const objectName of [...contents().keys()].sort()) {
          if (!objectName.startsWith(prefix)) continue;
          const cut = query.delimiter
            ? objectName.indexOf(query.delimiter, prefix.length)
            : -1;
          if (cut === -1) items.push(objectName);
          else prefixes.add(objectName.slice(0, cut + 1));
        }
        const files = items.map(file);
        if (query.autoPaginate !== false) return [files, query];
        return [
          files,
          null,
          {
            kind: "storage#objects",
            ...(items.length ? { items: items.map((n) => ({ name: n })) } : {}),
            ...(prefixes.size ? { prefixes: [...prefixes] } : {}),
          },
        ];
      },
    ),
    file: vi.fn(file),
  };
}
let buckets: Map<string, ReturnType<typeof fakeBucket>>;

const bucket = (name: string) => {
  if (!buckets.has(name)) buckets.set(name, fakeBucket(name));
  return buckets.get(name)!;
};

function stored(name: string, objectName: string, metadata: Doc = {}) {
  if (!objects.has(name)) objects.set(name, new Map());
  objects.get(name)!.set(objectName, metadata);
}

const NOW = new Date("2026-10-02T10:00:00Z");

function reported(
  id: string,
  job: string,
  startedAt: string,
  fields: Doc = {},
) {
  docsOf(OPS, "jobRuns").set(id, {
    job,
    state: "succeeded",
    trigger: "schedule",
    host: "cloud-run:krs-scrape-free/exec",
    startedAt: ts(startedAt),
    heartbeatAt: ts(startedAt),
    finishedAt: ts(startedAt),
    progress: null,
    counters: {},
    phase: null,
    stopReason: null,
    errors: [],
    exitCode: 0,
    summaryPath: null,
    version: null,
    ...fields,
  });
}

function record(job: string, fields: Doc) {
  docsOf(OPS, "jobs").set(job, { job, ...fields });
}

function captured(
  id: string,
  status: string,
  capturedAt: string,
  fields: Doc = {},
) {
  docsOf(SITE, "articlePages").set(id, {
    url: `https://example.pl/${id}`,
    normalizedUrl: `example.pl/${id}`,
    domain: "example.pl",
    title: `Strona ${id}`,
    storagePath: `gs://koryta-pl-crawled/hostname=example.pl/${id}.tar.gz`,
    htmlSha256: "0".repeat(64),
    htmlBytes: 1024,
    selection: null,
    source: "extension",
    status,
    capturedBy: "kasia",
    capturedAt: ts(capturedAt),
    updatedAt: ts(capturedAt),
    ...fields,
  });
}

const view = (overview: { jobs: JobView[] }, id: string) =>
  overview.jobs.find((job) => job.id === id)!;

const minutesBefore = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) - minutes * 60_000).toISOString();

describe("/api/ops/jobs", () => {
  const usedEmulators = process.env.USE_EMULATORS;
  // nuxt.config.ts sets the emulator host in every process that loads it,
  // this one included; production never has it.
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

  beforeEach(() => {
    vi.clearAllMocks();
    collections.clear();
    objects.clear();
    failures = new Map();
    counted = [];
    countFailure = undefined;
    getAlls = new Map();
    buckets = new Map();
    clearProbeCache();
    delete process.env.USE_EMULATORS;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(requireOwner).mockResolvedValue({ uid: "owner" } as never);
    mockGetFirestore.mockImplementation((database: string) => fakeDb(database));
    mockGetStorage.mockImplementation(() => ({ bucket }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (usedEmulators === undefined) delete process.env.USE_EMULATORS;
    else process.env.USE_EMULATORS = usedEmulators;
    if (emulatorHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
  });

  describe("route", () => {
    const call = () =>
      (handler as unknown as (event: unknown) => Promise<unknown>)({});

    it("refuses anybody but the owner before reading anything", async () => {
      vi.mocked(requireOwner).mockRejectedValue(
        Object.assign(new Error("no"), { statusCode: 403 }),
      );
      await expect(call()).rejects.toMatchObject({ statusCode: 403 });
      expect(mockGetFirestore).not.toHaveBeenCalled();
      expect(mockGetStorage).not.toHaveBeenCalled();
    });

    it("answers the owner with every registered job", async () => {
      process.env.USE_EMULATORS = "true";
      const overview = (await call()) as { jobs: JobView[] };
      expect(overview.jobs.map((job) => job.id)).toEqual(
        JOBS.map((job) => job.id),
      );
      expect(vi.mocked(requireOwner).mock.invocationCallOrder[0]!).toBeLessThan(
        mockGetFirestore.mock.invocationCallOrder[0]!,
      );
    });
  });

  describe("reported runs", () => {
    it("groups runs per job, newest first, with their times as ISO strings", async () => {
      reported("a1", "krs_scrape_free", "2026-09-30T22:30:00Z");
      reported("a2", "krs_scrape_free", "2026-10-01T22:30:00Z", {
        state: "running",
        finishedAt: null,
        heartbeatAt: ts("2026-10-01T22:41:00Z"),
      });
      reported("b1", "krs_scrape_paid", "2026-09-15T08:00:00Z");
      docsOf(OPS, "jobRuns").set("junk", { state: "running" });
      record("krs_scrape_free", {
        lastRunId: "a2",
        lastStartedAt: ts("2026-10-01T22:30:00Z"),
        lastScheduledAt: ts("2026-10-01T22:30:00Z"),
        lastSucceededAt: ts("2026-09-30T23:00:00Z"),
        lastState: "running",
      });

      const { runs, records } = await reportedRuns();
      expect(mockGetFirestore).toHaveBeenCalledWith(OPS);
      expect(runs.get("krs_scrape_free")!.map((run) => run.id)).toEqual([
        "a2",
        "a1",
      ]);
      expect(runs.get("krs_scrape_free")![0]).toMatchObject({
        state: "running",
        startedAt: "2026-10-01T22:30:00.000Z",
        heartbeatAt: "2026-10-01T22:41:00.000Z",
        finishedAt: null,
      });
      expect(runs.get("krs_scrape_paid")!.map((run) => run.id)).toEqual(["b1"]);
      expect([...runs.keys()].sort()).toEqual([
        "krs_scrape_free",
        "krs_scrape_paid",
      ]);
      expect(records.get("krs_scrape_free")).toEqual({
        lastRunId: "a2",
        lastStartedAt: "2026-10-01T22:30:00.000Z",
        lastScheduledAt: "2026-10-01T22:30:00.000Z",
        lastSucceededAt: "2026-09-30T23:00:00.000Z",
      });
      // Its newest run was in the window, so nothing was fetched one by one.
      expect(getAlls.get(OPS)).not.toHaveBeenCalled();
    });

    it("fetches a job's last run through its record once it has left the recent window", async () => {
      // A chatty job fills the window with newer runs.
      for (let i = 0; i < 300; i++) {
        reported(
          `chatty-${String(i).padStart(3, "0")}`,
          "chatty",
          minutesBefore("2026-10-02T09:00:00Z", i),
        );
      }
      reported("old-free", "krs_scrape_free", "2026-06-01T22:30:00Z", {
        state: "partial",
      });
      record("krs_scrape_free", { lastRunId: "old-free" });
      record("compressor", { lastRunId: "deleted-run" });
      record("chatty", { lastRunId: "chatty-000" });

      const { runs } = await reportedRuns();
      expect(runs.get("chatty")).toHaveLength(300);
      expect(runs.get("krs_scrape_free")!.map((run) => run.id)).toEqual([
        "old-free",
      ]);
      expect(runs.has("compressor")).toBe(false);
      const getAll = getAlls.get(OPS)!;
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(
        getAll.mock.calls[0]!.map((ref: { id: string }) => ref.id).sort(),
      ).toEqual(["deleted-run", "old-free"]);
    });

    it("shows a job's newest runs only, and unknown jobs under others", async () => {
      process.env.USE_EMULATORS = "true";
      for (let i = 0; i < 12; i++) {
        reported(
          `free-${String(i).padStart(2, "0")}`,
          "krs_scrape_free",
          `2026-09-${String(10 + i).padStart(2, "0")}T22:30:00Z`,
        );
        reported(
          `stray-${String(i).padStart(2, "0")}`,
          "zz_stray",
          `2026-09-${String(10 + i).padStart(2, "0")}T12:00:00Z`,
        );
      }
      record("aa_record_only", { lastRunId: null });

      const overview = await jobsOverview(NOW);
      const free = view(overview, "krs_scrape_free");
      expect(free.runs).toHaveLength(RUNS_SHOWN);
      expect(free.runs[0]!.id).toBe("free-11");
      expect(free.runs.at(-1)!.id).toBe(
        `free-${String(12 - RUNS_SHOWN).padStart(2, "0")}`,
      );
      expect(overview.others.map((other) => other.id)).toEqual([
        "aa_record_only",
        "zz_stray",
      ]);
      expect(overview.others[1]!.runs).toHaveLength(RUNS_SHOWN);
      expect(overview.others[0]).toEqual({
        id: "aa_record_only",
        runs: [],
        record: {
          lastRunId: null,
          lastStartedAt: null,
          lastScheduledAt: null,
          lastSucceededAt: null,
        },
      });
      expect(overview.generatedAt).toBe(NOW.toISOString());
      expect(overview.problems).toEqual([]);
    });
  });

  describe("captures", () => {
    beforeEach(() => {
      // 22 finished today, one in the extractor (also among the newest), one
      // waiting since three days ago, one waiting since long before the week
      // the page looks back over, and two old failures.
      for (let i = 0; i < 22; i++) {
        captured(
          `done-${i}`,
          "done",
          minutesBefore("2026-10-02T09:00:00Z", i),
          {
            extraction: { tag: "capture_v1", factCount: i % 2 },
          },
        );
      }
      captured("going", "extracting", "2026-10-02T09:30:00Z");
      captured("waiting", "stored", "2026-09-29T08:00:00Z");
      captured("forgotten", "stored", "2026-09-20T08:00:00Z");
      captured("broke-recently", "error", "2026-09-30T08:00:00Z", {
        extraction: { tag: "capture_v1", error: "timeout" },
      });
      captured("broke-long-ago", "error", "2026-09-01T08:00:00Z");
    });

    it("merges the newest with the open ones, once each, newest first", async () => {
      const { runs } = await captureRuns(NOW);
      expect(mockGetFirestore).toHaveBeenCalledWith(SITE);
      const ids = runs.map((run) => run.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(21);
      expect(ids[0]).toBe("going");
      expect(ids.at(-1)).toBe("waiting");
      expect(ids).not.toContain("broke-recently");
      // Stuck for longer than the week the page looks back over: a fact about
      // last week, which would otherwise keep the row red for good.
      expect(ids).not.toContain("forgotten");
      expect(runs.find((run) => run.id === "going")).toMatchObject({
        job: "capture_extraction",
        state: "running",
        startedAt: "2026-10-02T09:30:00.000Z",
      });
      expect(runs.find((run) => run.id === "waiting")!.state).toBe("queued");
    });

    it("orders every count by capturedAt descending, as the one index does", async () => {
      await captureRuns(NOW);
      expect(counted).toHaveLength(4);
      for (const query of counted) {
        expect(query).toEqual({
          collection: "articlePages",
          order: ["capturedAt", "desc"],
        });
      }
    });

    it("still lists the captures when the counts fail", async () => {
      countFailure = Object.assign(
        new Error("9 FAILED_PRECONDITION: The query requires an index."),
        { code: 9 },
      );
      const overview = await jobsOverview(NOW);
      const captures = view(overview, "capture_extraction");
      expect(captures.runs).toHaveLength(21);
      expect(captures.captureStats).toBeNull();
      expect(captures.unavailable).toBeUndefined();
      expect(overview.problems).toEqual([
        "Nie udało się policzyć zapisów z ostatniego tygodnia: 9 FAILED_PRECONDITION: The query requires an index.",
      ]);
    });

    it("counts a week of captures per state", async () => {
      const { stats } = await captureRuns(NOW);
      expect(stats).toEqual({
        since: "2026-09-25T10:00:00.000Z",
        byState: {
          queued: 1,
          running: 1,
          succeeded: 22,
          partial: 0,
          failed: 1,
        },
      });
    });

    it("hangs the captures and their counts on the triggered job", async () => {
      process.env.USE_EMULATORS = "true";
      const overview = await jobsOverview(NOW);
      const captures = view(overview, "capture_extraction");
      expect(captures.runs).toHaveLength(21);
      expect(captures.captureStats!.byState.succeeded).toBe(22);
      expect(captures.record).toBeNull();
      expect(captures).not.toHaveProperty("probe");
    });
  });

  describe("a source that fails", () => {
    beforeEach(() => {
      process.env.USE_EMULATORS = "true";
      reported("a1", "krs_scrape_free", "2026-10-01T22:30:00Z");
      captured("c1", "done", "2026-10-02T09:00:00Z");
    });

    it("names the runs it could not read and still returns the captures", async () => {
      failures.set(
        OPS,
        Object.assign(
          new Error(
            "7 PERMISSION_DENIED: Missing or insufficient permissions.",
          ),
          { code: 7 },
        ),
      );
      const overview = await jobsOverview(NOW);
      expect(overview.problems).toEqual([
        "Nie udało się wczytać zgłoszonych uruchomień: 7 PERMISSION_DENIED: Missing or insufficient permissions.",
      ]);
      expect(
        view(overview, "capture_extraction").runs.map((r) => r.id),
      ).toEqual(["c1"]);
      expect(view(overview, "krs_scrape_free")).toMatchObject({
        runs: [],
        record: null,
        unavailable: true,
      });
      // The captures came back, so they are not marked.
      expect(view(overview, "capture_extraction").unavailable).toBeUndefined();
      expect(overview.others).toEqual([]);
    });

    it("names the captures it could not read and still returns the runs", async () => {
      failures.set(SITE, new Error("deadline exceeded"));
      const overview = await jobsOverview(NOW);
      expect(overview.problems).toEqual([
        "Nie udało się wczytać zapisanych artykułów: deadline exceeded",
      ]);
      expect(view(overview, "capture_extraction")).toMatchObject({
        runs: [],
        captureStats: null,
        unavailable: true,
      });
      expect(view(overview, "krs_scrape_free").unavailable).toBeUndefined();
      expect(view(overview, "krs_scrape_free").runs.map((r) => r.id)).toEqual([
        "a1",
      ]);
    });
  });

  describe("probes", () => {
    const probeOf = async (id: string, now = NOW) =>
      view(await jobsOverview(now), id).probe as ProbeResult | null;

    it("does not touch the buckets against the emulators", async () => {
      process.env.USE_EMULATORS = "true";
      const overview = await jobsOverview(NOW);
      expect(view(overview, "compressor").probe).toEqual({
        kind: "compressedMirror",
        error: "lokalnie zasobniki nie są sprawdzane",
      });
      expect(view(overview, "firestore_export").probe).toEqual({
        kind: "firestoreExport",
        error: "lokalnie zasobniki nie są sprawdzane",
      });
      expect(view(overview, "krs_scrape_free").probe).toBeNull();
      expect(mockGetStorage).not.toHaveBeenCalled();
    });

    it("does not touch them either when only the emulator host says so", async () => {
      // dev:build sets USE_EMULATORS for `nuxt build` alone; the server it
      // serves knows it is local only by the host the firebase plugin sets.
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      expect(await probeOf("compressor")).toEqual({
        kind: "compressedMirror",
        error: "lokalnie zasobniki nie są sprawdzane",
      });
      expect(mockGetStorage).not.toHaveBeenCalled();
    });

    describe("compressed mirror", () => {
      it("reads the newest archive per host, its size and when it was made", async () => {
        stored(
          COMPRESSED_BUCKET,
          "hostname=rejestr.io/from=2025-01-01/date=2026-07-31.tar.gz",
          { size: "28000000", timeCreated: "2026-08-01T03:00:00.000Z" },
        );
        stored(
          COMPRESSED_BUCKET,
          "hostname=rejestr.io/from=2026-07-31/date=2026-09-30.tar.gz",
          { size: "1200", timeCreated: "2026-10-01T03:00:00.000Z" },
        );
        stored(COMPRESSED_BUCKET, "hostname=rejestr.io/index.txt", {
          size: "10",
        });
        // The older layout, one archive per day.
        stored(
          COMPRESSED_BUCKET,
          "hostname=api-krs.ms.gov.pl/date=2026-09-29.tar.gz",
          { size: 512, timeCreated: "2026-09-30T03:00:00.000Z" },
        );
        stored(
          COMPRESSED_BUCKET,
          "hostname=api-krs.ms.gov.pl.old/date=2026-10-01.tar.gz",
          { size: "1", timeCreated: "2026-10-02T03:00:00.000Z" },
        );

        expect(
          await compressedMirror([
            "rejestr.io",
            "api-krs.ms.gov.pl",
            "example.pl",
          ]),
        ).toEqual([
          {
            host: "rejestr.io",
            through: "2026-09-30",
            archivedAt: "2026-10-01T03:00:00.000Z",
            bytes: 1200,
          },
          {
            host: "api-krs.ms.gov.pl",
            through: "2026-09-29",
            archivedAt: "2026-09-30T03:00:00.000Z",
            bytes: 512,
          },
          { host: "example.pl", through: null, archivedAt: null, bytes: null },
        ]);
        expect(mockGetStorage).toHaveBeenCalled();
      });

      it("counts a total/ snapshot", async () => {
        stored(
          COMPRESSED_BUCKET,
          "hostname=api-krs.ms.gov.pl/total/date=2026-10-01.tar.gz",
          { size: "9", timeCreated: "2026-10-02T03:00:00.000Z" },
        );
        expect(await compressedMirror(["api-krs.ms.gov.pl"])).toEqual([
          {
            host: "api-krs.ms.gov.pl",
            through: "2026-10-01",
            archivedAt: "2026-10-02T03:00:00.000Z",
            bytes: 9,
          },
        ]);
      });

      it("goes by the total/ snapshot alone when a host has one, as the pipelines do", async () => {
        // CompressedMirror._pick_archives reads the newest total/ by itself
        // and ignores the deltas, so a delta newer than the snapshot is not
        // what any pipeline gets.
        stored(
          COMPRESSED_BUCKET,
          "hostname=api-krs.ms.gov.pl/total/date=2026-08-01.tar.gz",
          { size: "9", timeCreated: "2026-08-02T03:00:00.000Z" },
        );
        stored(
          COMPRESSED_BUCKET,
          "hostname=api-krs.ms.gov.pl/from=2026-08-01/date=2026-09-30.tar.gz",
          { size: "1", timeCreated: "2026-10-01T03:00:00.000Z" },
        );
        expect(await compressedMirror(["api-krs.ms.gov.pl"])).toEqual([
          {
            host: "api-krs.ms.gov.pl",
            through: "2026-08-01",
            archivedAt: "2026-08-02T03:00:00.000Z",
            bytes: 9,
          },
        ]);
      });

      it("arrives as the compressor's probe", async () => {
        stored(
          COMPRESSED_BUCKET,
          "hostname=rejestr.io/from=2026-07-31/date=2026-10-01.tar.gz",
          { size: "5", timeCreated: "2026-10-02T03:00:00.000Z" },
        );
        expect(await probeOf("compressor")).toEqual({
          kind: "compressedMirror",
          hosts: [
            {
              host: "rejestr.io",
              through: "2026-10-01",
              archivedAt: "2026-10-02T03:00:00.000Z",
              bytes: 5,
            },
            {
              host: "api-krs.ms.gov.pl",
              through: null,
              archivedAt: null,
              bytes: null,
            },
          ],
        });
      });
    });

    describe("what the mirror's writers did since", () => {
      it("marks each host with the runs written after its newest archive", async () => {
        stored(
          COMPRESSED_BUCKET,
          "hostname=rejestr.io/from=2026-07-31/date=2026-09-25.tar.gz",
        );
        stored(
          COMPRESSED_BUCKET,
          "hostname=api-krs.ms.gov.pl/from=2026-07-31/date=2026-10-01.tar.gz",
        );
        reported("paid-old", "krs_scrape_paid", "2026-09-20T09:00:00Z");
        reported("paid-new", "krs_scrape_paid", "2026-09-29T09:00:00Z");
        reported("free-before", "krs_scrape_free", "2026-09-30T22:30:00Z");
        const probe = await probeOf("compressor");
        expect(probe).toMatchObject({
          kind: "compressedMirror",
          hosts: [
            {
              host: "rejestr.io",
              through: "2026-09-25",
              newerData: "2026-09-29",
            },
            // 22:30 UTC on the 30th is the 1st in Warsaw: already archived.
            {
              host: "api-krs.ms.gov.pl",
              through: "2026-10-01",
              newerData: null,
            },
          ],
        });
      });

      it("leaves the cached probe as it was", async () => {
        stored(
          COMPRESSED_BUCKET,
          "hostname=rejestr.io/from=2026-07-31/date=2026-09-25.tar.gz",
        );
        reported("paid-new", "krs_scrape_paid", "2026-09-29T09:00:00Z");
        await probeOf("compressor");
        collections.clear();
        // Same probe from the cache; no runs now, so no writes to mark.
        const again = (await probeOf("compressor")) as {
          hosts: { newerData?: string | null }[];
        };
        expect(again.hosts[0]).not.toHaveProperty("newerData");
      });
    });

    describe("firestore export", () => {
      const folder = (startedAt: string) =>
        `hostname=koryta.pl/date=${startedAt}`;
      const exportAt = (startedAt: string, finishedAt?: string) => {
        stored(
          CRAWLED,
          `${folder(startedAt)}/all_namespaces/kind_nodes/output-0`,
          {},
        );
        if (finishedAt) {
          stored(
            CRAWLED,
            `${folder(startedAt)}/date=${startedAt}.overall_export_metadata`,
            { timeCreated: finishedAt },
          );
        }
      };

      it("lists today's folders and reads the newest one's marker", async () => {
        exportAt("2026-10-02T02:00:05.120Z", "2026-10-02T02:06:40.000Z");
        exportAt("2026-10-02T09:00:00.000Z", "2026-10-02T09:04:00.000Z");
        exportAt("2026-10-01T02:00:04.000Z", "2026-10-01T02:06:00.000Z");

        expect(await latestFirestoreExport(NOW)).toEqual({
          folder: "date=2026-10-02T09:00:00.000Z",
          startedAt: "2026-10-02T09:00:00.000Z",
          finishedAt: "2026-10-02T09:04:00.000Z",
        });
        const crawled = bucket(CRAWLED);
        expect(crawled.getFiles).toHaveBeenCalledTimes(1);
        expect(crawled.getFiles).toHaveBeenCalledWith({
          prefix: "hostname=koryta.pl/date=2026-10-02",
          delimiter: "/",
          autoPaginate: false,
        });
        expect(crawled.file).toHaveBeenCalledWith(
          "hostname=koryta.pl/date=2026-10-02T09:00:00.000Z/date=2026-10-02T09:00:00.000Z.overall_export_metadata",
        );
      });

      it("goes back to the previous UTC day, not the Warsaw one", async () => {
        // 01:30 on the 3rd in Warsaw, still the 2nd in UTC.
        const lateEvening = new Date("2026-10-02T23:30:00Z");
        exportAt("2026-10-01T02:00:04.000Z", "2026-10-01T02:06:00.000Z");
        expect(await latestFirestoreExport(lateEvening)).toMatchObject({
          startedAt: "2026-10-01T02:00:04.000Z",
          finishedAt: "2026-10-01T02:06:00.000Z",
        });
        expect(
          bucket(CRAWLED).getFiles.mock.calls.map(([query]) => query!.prefix),
        ).toEqual([
          "hostname=koryta.pl/date=2026-10-02",
          "hostname=koryta.pl/date=2026-10-01",
        ]);
      });

      it("is null with no export on either day", async () => {
        exportAt("2026-09-29T02:00:04.000Z", "2026-09-29T02:06:00.000Z");
        expect(await latestFirestoreExport(NOW)).toBeNull();
      });

      it("has no finish while the marker is missing", async () => {
        exportAt("2026-10-02T02:00:05.120Z");
        expect(await latestFirestoreExport(NOW)).toEqual({
          folder: "date=2026-10-02T02:00:05.120Z",
          startedAt: "2026-10-02T02:00:05.120Z",
          finishedAt: null,
        });
      });

      it("takes no crawl-layout day folder for an export", async () => {
        // What a capture of a koryta.pl page writes (crawlArchivePath): the
        // same prefix, a day where the export has a timestamp.
        stored(CRAWLED, "hostname=koryta.pl/date=2026-10-02/uid_0199.tar.gz", {
          timeCreated: "2026-10-02T01:00:00.000Z",
        });
        stored(CRAWLED, "hostname=koryta.pl/date=2026-10-01/uid_0198.tar.gz", {
          timeCreated: "2026-10-01T09:00:00.000Z",
        });
        exportAt("2026-10-01T02:00:04.000Z", "2026-10-01T02:06:00.000Z");
        expect(await latestFirestoreExport(NOW)).toEqual({
          folder: "date=2026-10-01T02:00:04.000Z",
          startedAt: "2026-10-01T02:00:04.000Z",
          finishedAt: "2026-10-01T02:06:00.000Z",
        });
      });

      it("arrives as the export's probe", async () => {
        exportAt("2026-10-02T02:00:05.120Z", "2026-10-02T02:06:40.000Z");
        expect(await probeOf("firestore_export")).toEqual({
          kind: "firestoreExport",
          latest: {
            folder: "date=2026-10-02T02:00:05.120Z",
            startedAt: "2026-10-02T02:00:05.120Z",
            finishedAt: "2026-10-02T02:06:40.000Z",
          },
        });
      });
    });

    it("says plainly when the bucket refuses, and passes other errors on", async () => {
      failures.set(
        COMPRESSED_BUCKET,
        Object.assign(new Error("caller does not have storage.objects.list"), {
          code: 403,
        }),
      );
      failures.set(
        CRAWLED,
        Object.assign(new Error("backend error"), { code: 503 }),
      );
      const overview = await jobsOverview(NOW);
      expect(view(overview, "compressor").probe).toEqual({
        kind: "compressedMirror",
        error: "brak dostępu do zasobnika",
      });
      expect(view(overview, "firestore_export").probe).toEqual({
        kind: "firestoreExport",
        error: "backend error",
      });
      // A probe is not a source: the page still loads, with nothing in problems.
      expect(overview.problems).toEqual([]);
    });

    it("serves a probe from its cache for five minutes", async () => {
      stored(
        COMPRESSED_BUCKET,
        "hostname=rejestr.io/from=2026-07-31/date=2026-10-01.tar.gz",
        { size: "5", timeCreated: "2026-10-02T03:00:00.000Z" },
      );
      const listings = () =>
        bucket(COMPRESSED_BUCKET).getFiles.mock.calls.length +
        bucket(CRAWLED).getFiles.mock.calls.length;

      const first = await probeOf("compressor");
      const listed = listings();
      expect(listed).toBeGreaterThan(0);

      // A newer archive appears, but the page asks again within the TTL.
      stored(
        COMPRESSED_BUCKET,
        "hostname=rejestr.io/from=2026-10-01/date=2026-10-02.tar.gz",
        { size: "6", timeCreated: "2026-10-03T03:00:00.000Z" },
      );
      const fourMinutes = new Date(NOW.getTime() + 4 * 60_000 + 59_000);
      expect(await probeOf("compressor", fourMinutes)).toEqual(first);
      expect(listings()).toBe(listed);

      const fiveMinutes = new Date(NOW.getTime() + 5 * 60_000);
      const fresh = await probeOf("compressor", fiveMinutes);
      expect(listings()).toBeGreaterThan(listed);
      expect(fresh).toMatchObject({
        hosts: [
          expect.objectContaining({ through: "2026-10-02" }),
          expect.objectContaining({ through: null }),
        ],
      });

      clearProbeCache();
      const relisted = listings();
      await probeOf("compressor", fiveMinutes);
      expect(listings()).toBeGreaterThan(relisted);
    });
  });
});
