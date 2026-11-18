import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRuntimeConfig } from "#app";
import handler from "../../../../server/api/ingest/declarations.post";

/** Every document, keyed by `collection/id`, and what each commit wrote. */
let stored: Record<string, Record<string, unknown> | undefined> = {};
let commits: { path: string; data: Record<string, unknown> }[][] = [];

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    get: vi.fn(async () => snapshot(`${collection}/${id}`)),
  };
}

function snapshot(path: string) {
  const id = path.slice(path.indexOf("/") + 1);
  return {
    id,
    exists: stored[path] !== undefined,
    data: () => stored[path],
  };
}

/** `where(...).where(...).get()` over `stored`, for what the reader queue's
 * order needs: the employment lookup (`pagesWithAPublicPost`) and the crops
 * that name a page (`pagesReached`). Equality, `in` and `array-contains`, on
 * one collection, which is all of Firestore this endpoint asks for. `select`
 * hands back every field, and `limit` is never reached. */
function query(
  collection: string,
  filters: { field: string; op: string; value: unknown }[] = [],
) {
  return {
    where: (field: string, op: string, value: unknown) =>
      query(collection, [...filters, { field, op, value }]),
    select: () => query(collection, filters),
    limit: () => query(collection, filters),
    get: async () => {
      const docs = Object.entries(stored)
        .filter(([path]) => path.startsWith(`${collection}/`))
        .filter(([, data]) =>
          filters.every(({ field, op, value }) => {
            const held = (data ?? {})[field];
            if (op === "in") return (value as unknown[]).includes(held);
            if (op === "array-contains") {
              return Array.isArray(held) && held.includes(value);
            }
            return held === value;
          }),
        )
        .map(([path]) => snapshot(path));
      return { docs, empty: docs.length === 0 };
    },
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => docRef(collection, id)),
    where: (field: string, op: string, value: unknown) =>
      query(collection).where(field, op, value),
  })),
  // A field mask, last, is read as every field.
  getAll: vi.fn(async (...refs: { path?: string }[]) =>
    refs.flatMap((ref) => (ref.path ? [snapshot(ref.path)] : [])),
  ),
  batch: vi.fn(() => {
    const pending: { path: string; data: Record<string, unknown> }[] = [];
    return {
      set: vi.fn((ref: { path: string }, data: Record<string, unknown>) =>
        pending.push({ path: ref.path, data }),
      ),
      commit: vi.fn(async () => {
        for (const { path, data } of pending) {
          // `{merge: true}`: the fields sent replace, the rest stay.
          stored[path] = { ...(stored[path] ?? {}), ...data };
        }
        commits.push(pending);
      }),
    };
  }),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => "NOW" },
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

const { mockGetUser, mockMatchAndDrain, mockCacheClear, mockRestage } =
  vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.createError = (err: any) =>
      Object.assign(new Error(err.message), err);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.defineEventHandler = (fn: any) => fn;
    const mockCacheClear = vi.fn();
    globalThis.useStorage = vi.fn(() => ({ clear: mockCacheClear }));
    return {
      mockGetUser: vi.fn().mockResolvedValue({
        uid: "pipeline-bip-declarations",
        datascience: true,
      }),
      mockMatchAndDrain: vi.fn(),
      mockCacheClear,
      mockRestage: vi.fn(),
    };
  });

// What a settled crop does to its pages is tested in
// tests/server/utils/declarationPublish.test.ts; here only that the upload
// hands over the crops it settles, under the configured limit, and survives
// a failure there. The limit is the runtime config's, which ships at 0, read
// as the site reads it.
vi.mock("../../../../server/utils/declarationPublish", () => ({
  matchAndDrain: mockMatchAndDrain,
}));
// Which pages the upload hands the people count, which
// tests/server/utils/declarationPeopleCount.test.ts runs.
vi.mock("../../../../server/utils/declarationPeopleCount", () => ({
  restageDeclarationPeople: mockRestage,
}));

// `requireDatascience` stays real; only the token lookup is faked.
vi.mock("../../../../server/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/utils/auth")>()),
  getUser: mockGetUser,
}));

let body: unknown = {};
const readValidatedBody = vi.fn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_event: any, parse: any) => parse(body),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).readValidatedBody = readValidatedBody;

/** A PNG header with a size, which is all the endpoint looks at. */
function png(width = 951, height = 105, padding = 0): string {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return Buffer.from(bytes).toString("base64");
}

const KEY = "f23a52f46489f75f";
const SHA = "a".repeat(64);

function candidacy(fields: Record<string, unknown> = {}) {
  return {
    key: KEY,
    kids: ["kowalska"],
    teryt: "021704",
    unitName: "Strzelin (gmina miejsko-wiejska)",
    level: "gmina",
    office: "Rada gminy",
    year: 2024,
    status: "found",
    reason: "named",
    files: 1,
    ...fields,
  };
}

function extract(fields: Record<string, unknown> = {}) {
  return {
    sha256: SHA,
    page: 0,
    url: "https://bip.strzelin.pl/download/1",
    declarationYear: 2023,
    candidacies: [KEY],
    outcome: "crop",
    images: { date: png(), name: png(1159, 94) },
    ...fields,
  };
}

const EXTRACT = `declarationExtracts/${SHA}-p0`;
const IMAGES = `declarationExtractImages/${SHA}-p0`;

async function send(payload: Record<string, unknown>) {
  body = { tag: "bip-cut-v1", ...payload };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await handler({} as any)) as any;
}

describe("api/ingest/declarations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = { "nodes/kowalska": { type: "person", name: "Anna Kowalska" } };
    commits = [];
    // In the runtime config the handler reads: Nitro's in the site, the Nuxt
    // app's here, which is what its `useRuntimeConfig` is auto-imported as in
    // the test environment.
    (
      useRuntimeConfig() as Record<string, unknown>
    ).declarationsDailyPublishLimit = 3;
    mockMatchAndDrain.mockResolvedValue({
      matched: [],
      drain: { published: [] },
    });
  });

  it("refuses a caller outside the datascience group before reading the body", async () => {
    mockGetUser.mockResolvedValueOnce({ uid: "reader" });
    await expect(send({ candidacies: [candidacy()] })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(readValidatedBody).not.toHaveBeenCalled();
    expect(commits).toHaveLength(0);
  });

  it("stores a candidacy and its crop, seeded for the reading queue", async () => {
    const result = await send({
      runId: "run-1",
      candidacies: [candidacy()],
      extracts: [extract()],
    });

    expect(result).toEqual({
      status: "ok",
      candidacies: { created: 1, updated: 0, skipped: [] },
      extracts: { created: 1, updated: 0, kept: 0, skipped: [] },
    });
    expect(stored[`declarationCandidacies/${KEY}`]).toMatchObject({
      personIds: ["kowalska"],
      teryt: "021704",
      office: "Rada gminy",
      status: "found",
      tag: "bip-cut-v1",
      runId: "run-1",
      uploaderUid: "pipeline-bip-declarations",
      createdAt: "NOW",
    });
    expect(stored[EXTRACT]).toMatchObject({
      status: "open",
      answerCount: 0,
      agreed: null,
      personIds: ["kowalska"],
      candidacyKeys: [KEY],
      units: [
        {
          teryt: "021704",
          unitName: "Strzelin (gmina miejsko-wiejska)",
          level: "gmina",
          office: "Rada gminy",
          year: 2024,
        },
      ],
      host: "bip.strzelin.pl",
      hasNameImage: true,
      imageSize: {
        date: { width: 951, height: 105 },
        name: { width: 1159, height: 94 },
      },
    });
    expect(typeof stored[EXTRACT]!.rand).toBe("number");
    expect(stored[EXTRACT]!.imageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[IMAGES]!.date).toBeInstanceOf(Buffer);
  });

  describe("the order readers are sent the crops in", () => {
    /** Her page, and a seat on the board of a company the gmina owns. */
    const priorityOf = async (
      node: Record<string, unknown>,
      world: Record<string, Record<string, unknown>> = {},
    ) => {
      stored = {
        "nodes/kowalska": { type: "person", name: "Anna Kowalska", ...node },
        "nodes/wodociagi": {
          type: "place",
          name: "Wodociągi Strzelin",
          isPublic: true,
        },
        "edges/kowalska-job": {
          type: "employed",
          name: "Rada Nadzorcza",
          source: "kowalska",
          target: "wodociagi",
          start_date: "2020-03-01",
        },
        ...world,
      };
      await send({ candidacies: [candidacy()], extracts: [extract()] });
      return stored[EXTRACT]!.priority;
    };

    it("puts drafts first, a dated one before an undated one, and published pages last", async () => {
      expect(await priorityOf({ birthDate: "1979-07-15" })).toBe(0);
      expect(await priorityOf({})).toBe(1);
      expect(
        await priorityOf({ published: true, birthDate: "1979-07-15" }),
      ).toBe(3);
    });

    it("puts a draft with no paid public post behind both", async () => {
      // Nobody could show who owns her only employer, which is not evidence
      // that it is private - and not a post the automation publishes for.
      expect(
        await priorityOf(
          { birthDate: "1979-07-15" },
          { "nodes/wodociagi": { type: "place", name: "Spółka X" } },
        ),
      ).toBe(2);
      // No employment on the page at all.
      expect(
        await priorityOf(
          { birthDate: "1979-07-15" },
          { "edges/kowalska-job": {} },
        ),
      ).toBe(2);
    });

    it("counts a seat nobody is paid for as no post", async () => {
      // An SPZOZ hospital's rada społeczna, stored - as every supervisory
      // seat is - under the name „Rada Nadzorcza”.
      expect(
        await priorityOf(
          { birthDate: "1979-07-15" },
          {
            "nodes/wodociagi": {
              type: "place",
              name: "Szpital w Strzelinie",
              isPublic: true,
              supervisoryBody: "rada-spoleczna",
            },
          },
        ),
      ).toBe(2);
    });

    it("counts a post that has ended, and a company still in draft", async () => {
      expect(
        await priorityOf(
          { birthDate: "1979-07-15" },
          {
            "edges/kowalska-job": {
              type: "employed",
              name: "Zarząd",
              source: "kowalska",
              target: "wodociagi",
              start_date: "2015-01-01",
              end_date: "2019-12-31",
            },
          },
        ),
      ).toBe(0);
    });

    it("puts the crops of a person a reading has reached last", async () => {
      // Another of her declarations, settled and compared with her page.
      const read = (fields: Record<string, unknown>) => ({
        "declarationExtracts/read": {
          status: "agreed",
          agreed: { value: "1979-07-15", kind: "date", by: "readers" },
          personIds: ["kowalska"],
          pageOutcomes: { kowalska: "queued" },
          ...fields,
        },
      });
      expect(await priorityOf({ birthDate: "1979-07-15" }, read({}))).toBe(4);
      // Read as another day, it reached her all the same.
      expect(
        await priorityOf(
          { birthDate: "1979-07-15" },
          read({ pageOutcomes: { kowalska: "different" } }),
        ),
      ).toBe(4);
      // A year alone, a reading an admin took back, and one never compared
      // reach nobody.
      for (const fields of [
        { agreed: { value: "1979", kind: "year", by: "readers" } },
        { status: "withdrawn" },
        { pageOutcomes: {} },
      ]) {
        expect(
          await priorityOf({ birthDate: "1979-07-15" }, read(fields)),
        ).toBe(0);
      }
    });

    it("puts a crop the job read another date off half a tier back", async () => {
      const withMachine = async (
        node: Record<string, unknown>,
        birthDate: string,
      ) => {
        stored = {
          "nodes/kowalska": { type: "person", name: "Anna Kowalska", ...node },
          "nodes/wodociagi": {
            type: "place",
            name: "Wodociągi Strzelin",
            isPublic: true,
          },
          "edges/kowalska-job": {
            type: "employed",
            name: "Rada Nadzorcza",
            source: "kowalska",
            target: "wodociagi",
            start_date: "2020-03-01",
          },
        };
        await send({
          candidacies: [candidacy()],
          extracts: [
            extract({
              machine: { birthDate, confidence: "low", method: "ocr" },
            }),
          ],
        });
        return stored[EXTRACT]!.priority;
      };
      // Most likely somebody else's: still ahead of an undated draft.
      expect(await withMachine({ birthDate: "1979-07-15" }, "1981-02-03")).toBe(
        0.5,
      );
      // The page's own date, or a page with no date to contradict.
      expect(await withMachine({ birthDate: "1979-07-15" }, "1979-07-15")).toBe(
        0,
      );
      expect(await withMachine({}, "1981-02-03")).toBe(1);
      // A year alone says nothing of the day.
      expect(await withMachine({ birthDate: "1979-07-15" }, "1981")).toBe(0);
    });

    it("leaves a page whose post somebody removed behind", async () => {
      expect(
        await priorityOf(
          { birthDate: "1979-07-15" },
          {
            "edges/kowalska-job": {
              type: "employed",
              name: "Rada Nadzorcza",
              source: "kowalska",
              target: "wodociagi",
              deleted: true,
            },
          },
        ),
      ).toBe(2);
    });
  });

  it("does not write the same picture twice", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    const result = await send({ extracts: [extract()] });
    expect(result.extracts).toMatchObject({ created: 0, updated: 1 });
    expect(commits[1]!.some((w) => w.path === IMAGES)).toBe(false);
  });

  it("keeps no date the site knows", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    const written = JSON.stringify(commits.flat().map((w) => w.data));
    expect(written).not.toMatch(/birthDate"\s*:\s*"\d{4}-\d{2}-\d{2}"/);
  });

  it("is safe to resend: no second document, the reading left alone", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    stored[EXTRACT] = {
      ...stored[EXTRACT],
      status: "agreed",
      answerCount: 2,
      rand: 0.5,
    };

    const result = await send({
      candidacies: [candidacy({ files: 2 })],
      extracts: [extract({ images: { date: png(800, 90), name: null } })],
    });

    expect(result.candidacies).toMatchObject({ created: 0, updated: 1 });
    expect(result.extracts).toMatchObject({ created: 0, updated: 0, kept: 1 });
    expect(stored[EXTRACT]).toMatchObject({
      status: "agreed",
      answerCount: 2,
      rand: 0.5,
      imageSize: { date: { width: 951, height: 105 } },
    });
    // The picture readers answered is the one that stays.
    expect(commits[1]!.some((w) => w.path === IMAGES)).toBe(false);
  });

  it("serves a crop to the candidacies of an earlier request", async () => {
    await send({ candidacies: [candidacy()] });
    const result = await send({ extracts: [extract()] });
    expect(result.extracts.created).toBe(1);
    expect(stored[EXTRACT]!.personIds).toEqual(["kowalska"]);
  });

  it("follows a merged page and skips a deleted one", async () => {
    stored["nodes/old"] = { type: "person", merged_into: "kowalska" };
    stored["nodes/gone"] = { type: "person", deleted: true };
    const result = await send({
      candidacies: [
        candidacy({ kids: ["old"] }),
        candidacy({ key: "0".repeat(16), kids: ["gone"] }),
      ],
    });
    expect(stored[`declarationCandidacies/${KEY}`]!.personIds).toEqual([
      "kowalska",
    ]);
    expect(result.candidacies.skipped).toEqual([
      { key: "0".repeat(16), reason: "no_site_person" },
    ]);
  });

  it("never sends readers a page of a file that names nobody unless the name on it is theirs", async () => {
    const unconfirmed = candidacy({ status: "unconfirmed", reason: "unnamed" });
    const refused = await send({
      candidacies: [unconfirmed],
      extracts: [extract()],
    });
    expect(refused.extracts.skipped).toEqual([
      { id: `${SHA}-p0`, reason: "unconfirmed_name" },
    ]);
    expect(stored[EXTRACT]).toBeUndefined();

    const named = await send({
      candidacies: [unconfirmed],
      extracts: [extract({ machine: { nameMatches: true } })],
    });
    expect(named.extracts.created).toBe(1);
  });

  it("skips what it cannot place or read", async () => {
    const result = await send({
      candidacies: [candidacy()],
      extracts: [
        extract({ candidacies: ["1".repeat(16)] }),
        extract({
          page: 1,
          images: { date: Buffer.from("GIF89a").toString("base64") },
        }),
      ],
    });
    expect(result.extracts.skipped).toEqual([
      { id: `${SHA}-p0`, reason: "unknown_candidacy" },
      { id: `${SHA}-p1`, reason: "bad_image" },
    ]);
  });

  it("records a file nothing could be cut from, out of the queue", async () => {
    await send({
      candidacies: [candidacy()],
      extracts: [
        extract({ outcome: "failed", reason: "blank_form", images: undefined }),
      ],
    });
    expect(stored[EXTRACT]).toMatchObject({
      status: "failed",
      failure: "blank_form",
    });
    expect(stored[IMAGES]).toBeUndefined();
  });

  it("settles a typed date the job read with high confidence, without readers", async () => {
    await send({
      candidacies: [candidacy()],
      extracts: [
        extract({
          outcome: "read",
          images: undefined,
          machine: {
            birthDate: "1979-07-15",
            confidence: "high",
            method: "text_layer",
          },
        }),
      ],
    });
    expect(stored[EXTRACT]).toMatchObject({
      status: "agreed",
      agreed: { value: "1979-07-15", kind: "date", by: "machine" },
    });
    expect(stored[IMAGES]).toBeUndefined();
  });

  it("compares a crop it settles with its pages, once the crops are stored", async () => {
    mockMatchAndDrain.mockImplementationOnce(async () => {
      // Stored first: the comparison reads the crop back.
      expect(stored[EXTRACT]).toMatchObject({ status: "agreed" });
      return { matched: [], drain: { published: ["kowalska"] } };
    });
    await send({
      candidacies: [candidacy()],
      extracts: [
        extract({
          outcome: "read",
          images: undefined,
          machine: { birthDate: "1979-07-15", confidence: "high" },
        }),
      ],
    });
    expect(mockMatchAndDrain).toHaveBeenCalledTimes(1);
    const [db, ids, , limit] = mockMatchAndDrain.mock.calls[0]!;
    expect(db).toBe(mockDb);
    expect(ids).toEqual([`${SHA}-p0`]);
    expect(limit).toBe(3);
    // Something went up, so the cached pages that counted it as a draft go.
    expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
  });

  it("leaves the comparison alone when nothing it stores is settled", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    expect(stored[EXTRACT]).toMatchObject({ status: "open", pageMatch: null });
    expect(mockMatchAndDrain).not.toHaveBeenCalled();
  });

  it("still answers the upload when the comparison fails", async () => {
    mockMatchAndDrain.mockRejectedValueOnce(new Error("contention"));
    const result = await send({
      candidacies: [candidacy()],
      extracts: [
        extract({
          outcome: "read",
          images: undefined,
          machine: { birthDate: "1979-07-15", confidence: "high" },
        }),
      ],
    });
    expect(result.extracts.created).toBe(1);
    // Not compared, which is what the sweep's `pageMatch == null` finds.
    expect(stored[EXTRACT]).toMatchObject({
      status: "agreed",
      pageMatch: null,
    });
  });

  it("moves the people of the crops it stores, and those its comparison touched", async () => {
    mockMatchAndDrain.mockResolvedValueOnce({
      matched: [{ outcomes: { kowalska: "queued" } }],
      drain: { published: ["nowak"] },
    });
    await send({
      candidacies: [candidacy()],
      extracts: [
        extract({
          outcome: "read",
          images: undefined,
          machine: { birthDate: "1979-07-15", confidence: "high" },
        }),
      ],
    });

    expect(mockRestage).toHaveBeenCalledWith(mockDb, ["kowalska", "nowak"]);
  });

  it("still answers the upload when the people count cannot be moved", async () => {
    // The real re-staging, on a database it cannot read.
    const { restageDeclarationPeople } = await vi.importActual<
      typeof import("../../../../server/utils/declarationPeopleCount")
    >("../../../../server/utils/declarationPeopleCount");
    mockRestage.mockImplementationOnce((_db, pages) =>
      restageDeclarationPeople(
        {
          ...mockDb,
          getAll: async () => {
            throw new Error("unavailable");
          },
        } as never,
        pages,
      ),
    );
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await send({
      candidacies: [candidacy()],
      extracts: [extract()],
    });

    expect(result.extracts.created).toBe(1);
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining("re-staging kowalska"),
      expect.any(Error),
    );
    quiet.mockRestore();
  });

  it("compares a settled crop again when it is sent for one more page", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    stored[EXTRACT] = {
      ...stored[EXTRACT],
      status: "agreed",
      agreed: { value: "1979-07-15", kind: "date", by: "readers" },
      answerCount: 2,
      pageMatch: "same",
    };
    stored["nodes/kowalska-2"] = { type: "person", name: "Anna Kowalska" };
    mockMatchAndDrain.mockClear();

    await send({
      candidacies: [candidacy({ kids: ["kowalska", "kowalska-2"] })],
      extracts: [extract()],
    });

    // Compared now, and uncompared for the sweep should that fail.
    expect(stored[EXTRACT]).toMatchObject({
      status: "agreed",
      personIds: ["kowalska", "kowalska-2"],
      pageMatch: null,
    });
    expect(mockMatchAndDrain).toHaveBeenCalledTimes(1);
    expect(mockMatchAndDrain.mock.calls[0]![1]).toEqual([`${SHA}-p0`]);
  });

  it("leaves a settled crop sent again for the same pages as it was", async () => {
    await send({ candidacies: [candidacy()], extracts: [extract()] });
    stored[EXTRACT] = {
      ...stored[EXTRACT],
      status: "agreed",
      agreed: { value: "1979-07-15", kind: "date", by: "readers" },
      answerCount: 2,
      pageMatch: "same",
    };
    mockMatchAndDrain.mockClear();

    await send({ candidacies: [candidacy()], extracts: [extract()] });

    expect(stored[EXTRACT]).toMatchObject({ pageMatch: "same" });
    expect(mockMatchAndDrain).not.toHaveBeenCalled();
  });

  describe("a date OCR read cleanly", () => {
    const ocr = {
      birthDate: "1979-07-15",
      confidence: "medium",
      method: "ocr",
      inPkwWindow: "yes",
    };

    it("settles the crop when it is already the page's birth date", async () => {
      stored["nodes/kowalska"] = {
        type: "person",
        name: "Anna Kowalska",
        birthDate: "1979-07-15",
      };
      await send({
        candidacies: [candidacy()],
        extracts: [extract({ machine: ocr })],
      });
      expect(stored[EXTRACT]).toMatchObject({
        status: "agreed",
        agreed: { value: "1979-07-15", kind: "date", by: "machine" },
        machine: { method: "ocr" },
        pageMatch: null,
      });
      // The picture is kept, for the admin who looks at the crop later.
      expect(stored[IMAGES]).toBeDefined();
      expect(mockMatchAndDrain).toHaveBeenCalledTimes(1);
      expect(mockMatchAndDrain.mock.calls[0]![1]).toEqual([`${SHA}-p0`]);
    });

    it("leaves it to readers when the page has another date or none", async () => {
      await send({
        candidacies: [candidacy()],
        extracts: [extract({ machine: ocr })],
      });
      expect(stored[EXTRACT]).toMatchObject({ status: "open", agreed: null });

      stored["nodes/kowalska"] = {
        type: "person",
        name: "Anna Kowalska",
        birthDate: "1979-07-16",
      };
      await send({
        candidacies: [candidacy()],
        extracts: [extract({ machine: ocr })],
      });
      expect(stored[EXTRACT]).toMatchObject({ status: "open", agreed: null });
      expect(mockMatchAndDrain).not.toHaveBeenCalled();
    });

    it("settles an open crop sent again once the page has the date", async () => {
      await send({
        candidacies: [candidacy()],
        extracts: [extract({ machine: ocr })],
      });
      stored["nodes/kowalska"] = {
        type: "person",
        name: "Anna Kowalska",
        birthDate: "1979-07-15",
      };

      await send({
        candidacies: [candidacy()],
        extracts: [extract({ machine: ocr })],
      });

      expect(stored[EXTRACT]).toMatchObject({
        status: "agreed",
        agreed: { value: "1979-07-15", by: "machine" },
      });
      expect(mockMatchAndDrain).toHaveBeenCalledTimes(1);
    });

    it("leaves a crop somebody has answered to its readers", async () => {
      await send({
        candidacies: [candidacy()],
        extracts: [extract({ machine: ocr })],
      });
      stored[EXTRACT] = { ...stored[EXTRACT], answerCount: 1 };
      stored["nodes/kowalska"] = {
        type: "person",
        name: "Anna Kowalska",
        birthDate: "1979-07-15",
      };

      await send({
        candidacies: [candidacy()],
        extracts: [extract({ machine: ocr })],
      });

      expect(stored[EXTRACT]).toMatchObject({ status: "open", agreed: null });
      expect(mockMatchAndDrain).not.toHaveBeenCalled();
    });
  });

  it("leaves a lower-confidence reading to readers", async () => {
    await send({
      candidacies: [candidacy()],
      extracts: [
        extract({ machine: { birthDate: "1979-07-15", confidence: "medium" } }),
      ],
    });
    expect(stored[EXTRACT]).toMatchObject({ status: "open", agreed: null });
  });

  it("refuses a request heavier than the limit", async () => {
    const big = png(951, 105, 190_000);
    await expect(
      send({
        candidacies: [candidacy()],
        extracts: Array.from({ length: 25 }, (_, page) =>
          extract({ page, images: { date: big, name: big } }),
        ),
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(commits).toHaveLength(0);
  });
});
