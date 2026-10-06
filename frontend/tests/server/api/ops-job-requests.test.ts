import { describe, it, expect, vi, beforeEach } from "vitest";
import requestHandler from "../../../server/api/ops/jobs/requests.post";
import listHandler from "../../../server/api/ops/jobs/requests.get";
import runHandler from "../../../server/api/ops/jobs/runs/[id].get";
import dispatchHandler from "../../../server/api/ops/jobs/runs/[id]/dispatch.post";
import { getUser } from "../../../server/utils/auth";
import { startRunner } from "../../../server/utils/jobRunner";
import { MAX_QUEUED, paddedKrs } from "../../../server/utils/jobRequests";
import type { JobRun } from "../../../shared/jobs";

type Doc = Record<string, unknown>;

const { Timestamp, mockGetFirestore, stores } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
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
    /** `<database>/<collection>` -> document id -> data. */
    stores: new Map<string, Map<string, Record<string, unknown>>>(),
  };
});

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  readValidatedBody: async (
    event: { body: unknown },
    parse: (body: unknown) => unknown,
  ) => parse(event.body),
  getValidatedQuery: async (
    event: { query: unknown },
    parse: (query: unknown) => unknown,
  ) => parse(event.query),
  getRouterParam: (event: { params?: Record<string, string> }, name: string) =>
    event.params?.[name],
}));

// Only `getUser` is faked: `requireDatascience` is a pure check on the token,
// so the routes' real gate runs against whatever this hands back.
vi.mock("~~/server/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/utils/auth")>()),
  getUser: vi.fn(),
}));

vi.mock("~~/server/utils/jobRunner", () => ({ startRunner: vi.fn() }));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp,
  getFirestore: mockGetFirestore,
}));

const OPS = "agent-tasks";
const SITE = "koryta-pl";

const docsOf = (database: string, collection: string) => {
  const key = `${database}/${collection}`;
  if (!stores.has(key)) stores.set(key, new Map());
  return stores.get(key)!;
};

/** A dotted field of a document, as a `where` reads it. */
const fieldOf = (doc: Doc, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object" ? (value as Doc)[part] : undefined,
      doc,
    );

function fakeDb(database: string) {
  const collection = (name: string) => {
    const docs = docsOf(database, name);
    const query = (filters: [string, unknown][]) => ({
      where: (field: string, op: string, value: unknown) => {
        if (op !== "==") throw new Error(`fake query: no ${op}`);
        return query([...filters, [field, value]]);
      },
      get: async () => {
        const found = [...docs].filter(([, doc]) =>
          filters.every(([field, value]) => fieldOf(doc, field) === value),
        );
        return {
          size: found.length,
          docs: found.map(([id, data]) => ({ id, data: () => data })),
        };
      },
    });
    return {
      ...query([]),
      doc: (id: string) => ({
        id,
        get: async () => ({
          id,
          exists: docs.has(id),
          data: () => docs.get(id),
        }),
        create: async (data: Doc) => {
          if (docs.has(id)) throw new Error("ALREADY_EXISTS");
          docs.set(id, data);
        },
        update: async (data: Doc) => {
          if (!docs.has(id)) throw new Error("NOT_FOUND");
          docs.set(id, { ...docs.get(id), ...data });
        },
      }),
    };
  };
  return { collection };
}

type Handler = (event: unknown) => Promise<unknown>;
const call = (handler: unknown, event: unknown) => (handler as Handler)(event);

function page(id: string, data: Doc) {
  docsOf(SITE, "nodes").set(id, data);
}

const company = () =>
  page("place1", {
    type: "place",
    name: "Wodociągi Miejskie",
    krsNumber: "123",
  });

const ask = (body: Doc) =>
  call(requestHandler, { body }) as Promise<{
    run: JobRun;
    reused: boolean;
    link: string;
  }>;

const queuedRuns = () =>
  [...docsOf(OPS, "jobRuns")].filter(([, doc]) => doc.state === "queued");

describe("runs asked for on a page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getUser).mockResolvedValue({
      uid: "analyst",
      name: "Ania",
      datascience: true,
    } as never);
    mockGetFirestore.mockImplementation((database: string) => fakeDb(database));
    vi.mocked(startRunner).mockResolvedValue({
      mode: "vm",
      at: "2026-10-06T10:00:01.000Z",
      ok: true,
      error: null,
    });
  });

  it("refuses anybody outside the datascience group before reading anything", async () => {
    vi.mocked(getUser).mockResolvedValue({
      uid: "admin",
      admin: true,
    } as never);
    company();

    for (const attempt of [
      () => ask({ nodeId: "place1" }),
      () => call(listHandler, { query: { node: "place1" } }),
      () => call(runHandler, { params: { id: "x" } }),
      () => call(dispatchHandler, { params: { id: "x" } }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(mockGetFirestore).not.toHaveBeenCalled();
    expect(startRunner).not.toHaveBeenCalled();
  });

  it("queues a company's people as a run the VM's worker can read, and starts the VM", async () => {
    company();

    const answer = await ask({ nodeId: "place1" });

    expect(answer.reused).toBe(false);
    expect(answer.link).toBe(`/admin/procesy#przebieg-${answer.run.id}`);
    const stored = docsOf(OPS, "jobRuns").get(answer.run.id)!;
    // The contract stores/job_requests.py reads.
    expect(stored).toMatchObject({
      job: "people_request",
      state: "queued",
      trigger: "request",
      title: "Wodociągi Miejskie",
      link: "/instytucja/wodociagi-miejskie-place1",
      request: {
        target: "company",
        nodeId: "place1",
        name: "Wodociągi Miejskie",
        krs: "0000000123",
        rejestrIo: null,
        dryRun: false,
        by: "analyst",
        byName: "Ania",
      },
    });
    expect(stored.startedAt).toBeInstanceOf(Timestamp);
    expect(startRunner).toHaveBeenCalledOnce();
    expect(stored.dispatch).toMatchObject({ mode: "vm", ok: true });
    expect(answer.run).toMatchObject({
      state: "queued",
      request: { target: "company", krs: "0000000123" },
      dispatch: { ok: true },
    });
  });

  it("queues a person with their page's register link, and a count alone when asked", async () => {
    page("p1", {
      type: "person",
      name: "Anna Nowak",
      rejestrIo: "https://rejestr.io/osoby/383093",
    });

    const { run } = await ask({ nodeId: "p1", dryRun: true });

    expect(run.request).toMatchObject({
      target: "person",
      rejestrIo: "https://rejestr.io/osoby/383093",
      krs: null,
      dryRun: true,
    });
    expect(run.link).toBe("/osoba/anna-nowak-p1");
  });

  it("asks about the page a duplicate was merged into", async () => {
    page("dup", { type: "person", name: "Anna Nowak", merged_into: "p1" });
    page("p1", { type: "person", name: "Anna Nowak" });

    const { run } = await ask({ nodeId: "dup" });

    expect(run.request?.nodeId).toBe("p1");
  });

  it("hands back the run a page already has waiting or going", async () => {
    company();
    const first = await ask({ nodeId: "place1" });

    const second = await ask({ nodeId: "place1" });

    expect(second).toMatchObject({ reused: true, run: { id: first.run.id } });
    expect(queuedRuns()).toHaveLength(1);
    expect(startRunner).toHaveBeenCalledOnce();

    // Once it has ended, the next click is a new run.
    docsOf(OPS, "jobRuns").get(first.run.id)!.state = "succeeded";
    const third = await ask({ nodeId: "place1" });
    expect(third.reused).toBe(false);
  });

  it("refuses what has no people to send", async () => {
    page("place2", { type: "place", name: "Bez numeru" });
    page("r1", { type: "region", name: "Mazowieckie" });
    page("gone", { type: "person", name: "Usunięta", deleted: true });

    await expect(ask({ nodeId: "place2" })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("nie ma numeru KRS"),
    });
    await expect(ask({ nodeId: "r1" })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(ask({ nodeId: "gone" })).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(ask({ nodeId: "nope" })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(queuedRuns()).toHaveLength(0);
  });

  it("refuses to add to a queue nobody is taking", async () => {
    company();
    for (let n = 0; n < MAX_QUEUED; n++) {
      docsOf(OPS, "jobRuns").set(`old${n}`, {
        job: "people_request",
        state: "queued",
        request: { target: "company", nodeId: `place-${n}` },
      });
    }

    await expect(ask({ nodeId: "place1" })).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("keeps the run queued when the VM could not be started", async () => {
    vi.mocked(startRunner).mockResolvedValue({
      mode: "vm",
      at: "2026-10-06T10:00:01.000Z",
      ok: false,
      error: "Required 'compute.instances.start' permission",
    });
    company();

    const { run } = await ask({ nodeId: "place1" });

    expect(run.state).toBe("queued");
    expect(run.dispatch).toMatchObject({
      ok: false,
      error: "Required 'compute.instances.start' permission",
    });
  });

  it("lists a page's runs, newest first", async () => {
    const at = (iso: string) => Timestamp.fromDate(new Date(iso));
    const asked = (startedAt: string, nodeId = "place1") => ({
      job: "people_request",
      state: "succeeded",
      trigger: "request",
      startedAt: at(startedAt),
      request: { target: "company", nodeId, name: "W", dryRun: false },
    });
    docsOf(OPS, "jobRuns").set("older", asked("2026-10-01T10:00:00Z"));
    docsOf(OPS, "jobRuns").set("newer", asked("2026-10-05T10:00:00Z"));
    docsOf(OPS, "jobRuns").set("other", asked("2026-10-06T10:00:00Z", "p2"));

    const { runs } = (await call(listHandler, {
      query: { node: "place1" },
    })) as { runs: JobRun[] };

    expect(runs.map((run) => run.id)).toEqual(["newer", "older"]);
  });

  it("reads one run for its link - a reported one, else a capture", async () => {
    docsOf(OPS, "jobRuns").set("r1", {
      job: "nightly",
      state: "running",
      startedAt: Timestamp.fromDate(new Date("2026-10-06T02:30:00Z")),
    });
    docsOf(SITE, "articlePages").set("c1", {
      url: "https://example.pl/a",
      title: "Artykuł",
      status: "extracting",
      capturedAt: Timestamp.fromDate(new Date("2026-10-06T09:00:00Z")),
      updatedAt: Timestamp.fromDate(new Date("2026-10-06T09:00:05Z")),
    });

    const reported = (await call(runHandler, { params: { id: "r1" } })) as {
      run: JobRun;
    };
    const capture = (await call(runHandler, { params: { id: "c1" } })) as {
      run: JobRun;
    };

    expect(reported.run).toMatchObject({
      job: "nightly",
      state: "running",
      startedAt: "2026-10-06T02:30:00.000Z",
    });
    expect(capture.run).toMatchObject({
      job: "capture_extraction",
      state: "running",
      title: "Artykuł",
      url: "https://example.pl/a",
    });
    await expect(
      call(runHandler, { params: { id: "nope" } }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("starts the VM again for a run still waiting, and only for one", async () => {
    company();
    const { run } = await ask({ nodeId: "place1" });
    vi.mocked(startRunner).mockClear();

    const again = (await call(dispatchHandler, { params: { id: run.id } })) as {
      run: JobRun;
    };
    expect(again.run.id).toBe(run.id);
    expect(startRunner).toHaveBeenCalledOnce();

    docsOf(OPS, "jobRuns").get(run.id)!.state = "running";
    await expect(
      call(dispatchHandler, { params: { id: run.id } }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("pads a KRS number the way the employments carry it", () => {
    expect(paddedKrs("123")).toBe("0000000123");
    expect(paddedKrs(" 0000 012 345 ")).toBe("0000012345");
    expect(paddedKrs(12345)).toBe("0000012345");
    expect(paddedKrs("brak")).toBeNull();
    expect(paddedKrs("12345678901")).toBeNull();
    expect(paddedKrs(undefined)).toBeNull();
  });
});
