import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  PART_BYTES,
  readStoredAggregate,
  splitUtf8,
  storedAggregate,
  storedAggregateKey,
  warsawSixHourWindow,
} from "../../../server/utils/storedAggregate";

const { logger, mockGetFirestore } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockGetFirestore: vi.fn(),
}));

vi.mock("firebase-functions/logger", () => ({ logger }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: mockGetFirestore }));

/** `stats` documents by id. */
let docs: Map<string, Record<string, unknown>>;
/** Ids of the documents read, in order. */
let reads: string[];
let failReads = false;
let failWrites = false;

function snapshot(id: string) {
  reads.push(id);
  const data = docs.get(id);
  return { id, exists: data !== undefined, data: () => data };
}

const db = {
  collection: vi.fn((name: string) => {
    if (name !== "stats") throw new Error(`read of ${name}`);
    return {
      doc: (id: string) => ({
        id,
        get: async () => {
          if (failReads) throw new Error("UNAVAILABLE");
          return snapshot(id);
        },
      }),
    };
  }),
  getAll: vi.fn(async (...refs: { id: string }[]) =>
    refs.map((ref) => snapshot(ref.id)),
  ),
  batch: vi.fn(() => {
    const writes: [string, Record<string, unknown>][] = [];
    return {
      set: (ref: { id: string }, data: Record<string, unknown>) => {
        // Firestore refuses a document holding an undefined value.
        if (Object.values(data).includes(undefined)) {
          throw new Error("Cannot use undefined as a Firestore value");
        }
        writes.push([ref.id, data]);
      },
      commit: async () => {
        if (failWrites) throw new Error("UNAVAILABLE");
        for (const [id, data] of writes) docs.set(id, data);
      },
    };
  }),
} as unknown as Firestore;

/** As Cloud Run names an App Hosting backend and its build. */
function onCloudRun(build = "prod-build-001") {
  vi.stubEnv("K_SERVICE", "prod");
  vi.stubEnv("K_REVISION", build);
}

function offCloudRun() {
  vi.stubEnv("K_SERVICE", "");
  vi.stubEnv("K_REVISION", "");
}

const census = { people: 3, parties: { PiS: 2 }, generatedAt: "2026-11-23" };
const compute = vi.fn(async () => structuredClone(census));

const stored = (period = "2026-11-23T12", options = {}) =>
  storedAggregate({ db, name: "census", period, compute, ...options });

beforeEach(() => {
  vi.clearAllMocks();
  docs = new Map();
  reads = [];
  failReads = false;
  failWrites = false;
  mockGetFirestore.mockReturnValue(db);
  onCloudRun();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("warsawSixHourWindow", () => {
  it.each([
    // Winter: Warsaw is UTC+1.
    ["2026-11-23T10:59:59Z", "2026-11-23T06"],
    ["2026-11-23T11:00:00Z", "2026-11-23T12"],
    ["2026-11-23T16:59:59Z", "2026-11-23T12"],
    ["2026-11-23T17:00:00Z", "2026-11-23T18"],
    // Already the next day in Warsaw.
    ["2026-11-22T23:30:00Z", "2026-11-23T00"],
    // Summer: UTC+2.
    ["2026-07-01T03:59:00Z", "2026-07-01T00"],
    ["2026-07-01T04:00:00Z", "2026-07-01T06"],
    ["2026-07-01T22:30:00Z", "2026-07-02T00"],
  ])("puts %s in %s", (instant, window) => {
    expect(warsawSixHourWindow(new Date(instant))).toBe(window);
  });
});

describe("storedAggregateKey", () => {
  it("names one document per backend, keyed on the build and the period", () => {
    expect(storedAggregateKey("census", "2026-11-23T12")).toEqual({
      docId: "census_prod",
      key: "prod-build-001|2026-11-23T12",
    });
  });

  it("is null off Cloud Run", () => {
    vi.stubEnv("K_REVISION", "");
    expect(storedAggregateKey("census", "2026-11-23T12")).toBeNull();
    onCloudRun();
    vi.stubEnv("K_SERVICE", "");
    expect(storedAggregateKey("census", "2026-11-23T12")).toBeNull();
  });
});

describe("storedAggregate", () => {
  it("computes on every call off Cloud Run and touches no database", async () => {
    offCloudRun();

    await stored();
    await stored();

    expect(compute).toHaveBeenCalledTimes(2);
    expect(db.collection).not.toHaveBeenCalled();
    expect(mockGetFirestore).not.toHaveBeenCalled();
    expect(docs.size).toBe(0);
  });

  it("computes and stores on a miss, then reads the stored copy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T11:30:00Z"));

    const first = await stored();
    expect(compute).toHaveBeenCalledTimes(1);
    expect(docs.get("census_prod")).toEqual({
      type: "storedAggregate",
      name: "census",
      key: "prod-build-001|2026-11-23T12",
      computedAt: "2026-11-23T11:30:00.000Z",
      parts: 1,
      part: 0,
      json: JSON.stringify(census),
    });
    expect(logger.info).toHaveBeenCalledTimes(1);

    reads = [];
    const second = await stored();

    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(reads).toEqual(["census_prod"]);
  });

  it("computes again for a new build or a new period", async () => {
    await stored();

    onCloudRun("prod-build-002");
    await stored();
    expect(compute).toHaveBeenCalledTimes(2);
    expect(docs.get("census_prod")!.key).toBe("prod-build-002|2026-11-23T12");

    await stored("2026-11-23T18");
    expect(compute).toHaveBeenCalledTimes(3);
    expect(docs.get("census_prod")!.key).toBe("prod-build-002|2026-11-23T18");

    // A backend keeps its own copy.
    vi.stubEnv("K_SERVICE", "autopush");
    await stored("2026-11-23T18");
    expect(compute).toHaveBeenCalledTimes(4);
    expect([...docs.keys()].sort()).toEqual(["census_autopush", "census_prod"]);
  });

  it("uses the site's database when none is given", async () => {
    await storedAggregate({ name: "census", period: "2026-11-23T12", compute });

    expect(mockGetFirestore).toHaveBeenCalledWith("koryta-pl");
    expect(docs.has("census_prod")).toBe(true);
  });

  it("still answers when the copy cannot be stored", async () => {
    failWrites = true;

    expect(await stored()).toEqual(census);
    expect(docs.size).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      "[storedAggregate] census could not be stored",
      expect.objectContaining({ error: "UNAVAILABLE" }),
    );

    // The next call tries again rather than giving up on storing.
    failWrites = false;
    await stored();
    expect(compute).toHaveBeenCalledTimes(2);
    expect(docs.has("census_prod")).toBe(true);
  });

  it("computes when the copy cannot be read", async () => {
    await stored();
    failReads = true;

    expect(await stored()).toEqual(census);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      "[storedAggregate] census could not be read",
      expect.objectContaining({ error: "UNAVAILABLE" }),
    );
  });

  it("does not let a failed compute store anything", async () => {
    compute.mockRejectedValueOnce(new Error("DEADLINE_EXCEEDED"));

    await expect(stored()).rejects.toThrow("DEADLINE_EXCEEDED");
    expect(docs.size).toBe(0);
  });

  it("stores no undefined values, which Firestore refuses", async () => {
    const value = {
      people: 3,
      party: undefined,
      rows: [{ id: "a", x: undefined }],
    };

    await stored("2026-11-23T12", { compute: async () => value });
    reads = [];
    const back = await stored("2026-11-23T12", { compute: async () => value });

    expect(back).toEqual({ people: 3, rows: [{ id: "a" }] });
    expect(reads).toEqual(["census_prod"]);
  });

  it("keeps a nested array, which a Firestore document cannot hold", async () => {
    const value = { matrix: [[1, 2], [3]] };

    await stored("2026-11-23T12", { compute: async () => value });
    const back = await stored("2026-11-23T12", { compute });

    expect(back).toEqual(value);
  });

  describe("a value larger than one document", () => {
    // Over three documents' worth, with two-byte letters in every url so that
    // a cut has every chance of landing inside one.
    const urls = Array.from({ length: 40_000 }, (_, i) => ({
      loc: `/instytucja/zakład-gospodarki-łódź-${i}`,
      lastmod: "2026-11-20T12:00:00.000Z",
    }));

    it("is split across numbered documents and read back whole", async () => {
      await stored("2026-11-23T12", { compute: async () => urls });

      const json = JSON.stringify(urls);
      const parts = Math.ceil(Buffer.byteLength(json) / PART_BYTES);
      expect(parts).toBeGreaterThan(2);
      const ids = [
        "census_prod",
        ...Array.from(
          { length: parts - 1 },
          (_, i) => `census_prod_part${i + 1}`,
        ),
      ];
      expect([...docs.keys()]).toEqual(ids);
      for (const [part, id] of ids.entries()) {
        const doc = docs.get(id)!;
        expect(doc).toMatchObject({
          parts,
          part,
          key: "prod-build-001|2026-11-23T12",
        });
        expect(Buffer.byteLength(doc.json as string)).toBeLessThanOrEqual(
          PART_BYTES,
        );
      }

      reads = [];
      const back = await stored("2026-11-23T12", { compute });

      expect(compute).not.toHaveBeenCalled();
      expect(back).toEqual(urls);
      expect(reads).toEqual(ids);
    });

    it("is not taken from parts another write left behind", async () => {
      await stored("2026-11-23T12", { compute: async () => urls });
      // As if a second instance rewrote the parts between this reader's reads.
      docs.set("census_prod_part1", {
        ...docs.get("census_prod_part1"),
        computedAt: "2026-11-23T11:59:00.000Z",
      });

      const back = await stored("2026-11-23T12", { compute });

      expect(compute).toHaveBeenCalledTimes(1);
      expect(back).toEqual(census);
    });

    it("reads as nothing stored when a part is missing", async () => {
      await stored("2026-11-23T12", { compute: async () => urls });
      docs.delete("census_prod_part2");

      expect(
        await readStoredAggregate(db, {
          docId: "census_prod",
          key: "prod-build-001|2026-11-23T12",
        }),
      ).toBeUndefined();
    });
  });
});

describe("splitUtf8", () => {
  // One-, two-, three- and four-byte characters.
  const text = "abcżółć😀xyz € ąę";

  it.each([4, 5, 6, 7, 10, 64])(
    "cuts into pieces of at most %i bytes, never inside a character",
    (maxBytes) => {
      const pieces = splitUtf8(text, maxBytes);

      expect(pieces.join("")).toBe(text);
      for (const piece of pieces) {
        expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(maxBytes);
        expect(piece).not.toContain("�");
      }
    },
  );

  it("leaves a short text whole", () => {
    expect(splitUtf8("[1,2]", PART_BYTES)).toEqual(["[1,2]"]);
  });

  it("refuses a budget a character might not fit in", () => {
    expect(() => splitUtf8(text, 3)).toThrow(RangeError);
  });
});
