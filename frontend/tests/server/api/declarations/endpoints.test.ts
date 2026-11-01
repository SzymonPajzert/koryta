import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRuntimeConfig } from "#app";
import answer from "../../../../server/api/declarations/[id]/answer.post";
import claim from "../../../../server/api/declarations/claim.post";
import found from "../../../../server/api/declarations/found.get";
import next from "../../../../server/api/declarations/next.get";
import sweep from "../../../../server/api/declarations/sweep.post";
import publishQueued from "../../../../server/api/declarations/publish-queued.post";
import {
  DAILY_AUTO_PUBLISH_LIMIT,
  PRESS_BATCH,
  READ_NAME_MAX_LENGTH,
} from "../../../../shared/declarations";
import { anonymousUid } from "../../../../server/utils/declarations";

/** What the endpoints hand to server/utils/declarationPublish.ts and
 * server/utils/declarations.ts, which are tested on their own: the reader
 * they answer for, the crops an answer or a claim settles, the configured
 * limit, and the gate in front of each. Who the reader is (`getReader`) runs
 * for real on the request's headers. The limit is read from the runtime
 * config the way the site reads it (`publishLimitOf`), not handed in by a
 * mock. */
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.getRouterParam = () => `${"a".repeat(64)}-p0`;
  globalThis.setResponseHeader = vi.fn();
  const request = {
    headers: {} as Record<string, string>,
    query: {} as Record<string, string>,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).getQuery = () => request.query;
  // Node hands h3 the headers lower-cased, whatever the browser sent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).getRequestHeader = (_event: unknown, name: string) =>
    request.headers[name.toLowerCase()];
  const clear = vi.fn();
  globalThis.useStorage = vi.fn(() => ({ clear }));
  return {
    body: {} as unknown,
    request,
    clear,
    getUser: vi.fn(),
    requireAdmin: vi.fn(),
    recordAnswer: vi.fn(),
    queueFor: vi.fn(),
    admitToQueue: vi.fn(),
    claimAnswers: vi.fn(),
    findsOf: vi.fn(),
    /** What `getFirestore` hands the endpoints: nothing to read, unless a
     * test runs the real claim against something. */
    db: {} as unknown,
    matchAndDrain: vi.fn(),
    sweepDeclarations: vi.fn(),
    drainPublications: vi.fn(),
    creditFinds: vi.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).readValidatedBody = async (_event: unknown, parse: any) =>
  parse(mocks.body);

/** Sets the limit in the runtime config the handlers read: Nitro's in the
 * site, the Nuxt app's here, which is what their `useRuntimeConfig` is
 * auto-imported as in the test environment. */
function configure(limit: unknown) {
  const config = useRuntimeConfig() as Record<string, unknown>;
  if (limit === undefined) delete config.declarationsDailyPublishLimit;
  else config.declarationsDailyPublishLimit = limit;
}

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => mocks.db }));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("../../../../server/utils/auth", async (original) => ({
  ...(await original<typeof import("../../../../server/utils/auth")>()),
  getUser: mocks.getUser,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("../../../../server/utils/declarations", async (original) => ({
  ...(await original<typeof import("../../../../server/utils/declarations")>()),
  recordAnswer: mocks.recordAnswer,
  queueFor: mocks.queueFor,
  admitToQueue: mocks.admitToQueue,
  claimAnswers: mocks.claimAnswers,
}));
vi.mock("../../../../server/utils/declarationFinds", () => ({
  findsOf: mocks.findsOf,
}));
vi.mock("../../../../server/utils/declarationPublish", () => ({
  matchAndDrain: mocks.matchAndDrain,
  sweepDeclarations: mocks.sweepDeclarations,
  drainPublications: mocks.drainPublications,
  creditFinds: mocks.creditFinds,
}));

const ID = `${"a".repeat(64)}-p0`;
const READER = "0f8fad5b-d9cb-469f-a165-70867728950e";
/** Where the answers of the browser with that id are filed: under its hash. */
const STRANGER = anonymousUid(READER);
const QUEUE = {
  task: null,
  upcoming: [],
  open: 0,
  mine: { today: 1, total: 1 },
};
const ON_A_DAY = {
  status: "agreed",
  value: "1979-07-15",
  kind: "date",
  readers: 2,
} as const;
const UNCONFIRMED = {
  uid: "unconfirmed",
  email_verified: false,
  firebase: { sign_in_provider: "password" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = {};
  configure(4);
  mocks.request.headers = { authorization: "Bearer token" };
  mocks.request.query = { count: "3" };
  mocks.getUser.mockResolvedValue({
    uid: "reader",
    email_verified: true,
    firebase: { sign_in_provider: "password" },
  });
  mocks.queueFor.mockResolvedValue(QUEUE);
  mocks.creditFinds.mockResolvedValue(0);
  mocks.matchAndDrain.mockResolvedValue({
    matched: [],
    drain: { published: [] },
  });
  mocks.body = { verdict: "date", value: "1979-07-15" };
});

function settles(settled: unknown) {
  mocks.recordAnswer.mockResolvedValue({
    settled,
    personIds: ["kowalska"],
  });
}

describe("api/declarations/[id]/answer", () => {
  it("compares a crop it settles on a day with its pages, one page of the queue at most", async () => {
    settles(ON_A_DAY);

    const result = await answer({} as never);

    expect(result).toMatchObject({ settled: true, answered: { id: ID } });
    expect(mocks.recordAnswer.mock.calls[0]![1]).toMatchObject({
      reader: { uid: "reader", votes: true, anonymous: false },
    });
    const [, ids, , limit, options] = mocks.matchAndDrain.mock.calls[0]!;
    expect(ids).toEqual([ID]);
    expect(limit).toBe(4);
    expect(options).toEqual({ maxPages: 1 });
  });

  it("compares nothing for an answer that settles nothing, or settles a year", async () => {
    settles(null);
    await answer({} as never);
    settles({ status: "agreed", value: "1979", kind: "year", readers: 2 });
    await answer({} as never);

    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
  });

  it("still answers the reader when the comparison fails", async () => {
    settles(ON_A_DAY);
    mocks.matchAndDrain.mockRejectedValueOnce(new Error("contention"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const result = await answer({} as never);

    expect(result).toMatchObject({ ...QUEUE, settled: true });
  });

  it("takes a reader without an account by their reader id, and never sets publication going", async () => {
    mocks.request.headers = { "x-reader-id": READER };
    // Their answer never settles a crop (`recordAnswer` does not even read
    // the others). Were one ever reported settled, the sweep would compare
    // it, not a stranger's request.
    settles(ON_A_DAY);

    await answer({} as never);

    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.recordAnswer.mock.calls[0]![1]).toMatchObject({
      reader: { uid: STRANGER, votes: false, anonymous: true },
    });
    expect(mocks.queueFor.mock.calls[0]![1]).toBe(STRANGER);
    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
  });

  // The tally's „Znaleziono” goes up with the answer that found somebody,
  // not once other readers agree.
  it("credits the reader with whom their date found before it reads their queue, with or without an account", async () => {
    settles(null);
    const order: string[] = [];
    mocks.creditFinds.mockImplementation(async () => {
      order.push("credit");
      return 1;
    });
    mocks.queueFor.mockImplementation(async () => {
      order.push("queue");
      return QUEUE;
    });

    await answer({} as never);
    mocks.request.headers = { "x-reader-id": READER };
    mocks.body = { verdict: "date", value: "1979" };
    await answer({} as never);

    expect(mocks.creditFinds.mock.calls.map((call) => call[1])).toEqual([
      {
        uid: "reader",
        extractId: ID,
        personIds: ["kowalska"],
        value: "1979-07-15",
      },
      {
        uid: STRANGER,
        extractId: ID,
        personIds: ["kowalska"],
        value: "1979",
      },
    ]);
    expect(order).toEqual(["credit", "queue", "credit", "queue"]);
  });

  it("credits nobody for an answer that is not a date", async () => {
    settles(null);
    for (const verdict of ["unreadable", "empty", "skip"]) {
      mocks.body = { verdict };
      await answer({} as never);
    }

    expect(mocks.recordAnswer).toHaveBeenCalledTimes(3);
    expect(mocks.creditFinds).not.toHaveBeenCalled();
  });

  it("lets an account without a confirmed address answer, without a vote", async () => {
    mocks.getUser.mockResolvedValue(UNCONFIRMED);
    settles(ON_A_DAY);

    await answer({} as never);

    expect(mocks.recordAnswer.mock.calls[0]![1]).toMatchObject({
      reader: { uid: "unconfirmed", votes: false, anonymous: false },
    });
    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
  });

  it("refuses a bad token even beside a reader id", async () => {
    mocks.request.headers = {
      authorization: "Bearer stale",
      "x-reader-id": READER,
    };
    mocks.getUser.mockRejectedValue(
      Object.assign(new Error("nieważny token"), { statusCode: 401 }),
    );

    await expect(answer({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.recordAnswer).not.toHaveBeenCalled();
  });

  // The page's name field holds as much and no more (TaskCard.vue): a longer
  // name would have the whole answer turned down, the date with it.
  it("keeps a name as long as the reading page's field holds, and turns a longer one down", async () => {
    settles(null);
    const name = "Ż".repeat(READ_NAME_MAX_LENGTH);
    mocks.body = { verdict: "unreadable", name };

    await answer({} as never);

    expect(mocks.recordAnswer.mock.calls[0]![1]).toMatchObject({
      answer: { verdict: "unreadable", name },
    });

    mocks.body = { verdict: "unreadable", name: `${name}Ż` };
    await expect(answer({} as never)).rejects.toThrow();
    expect(mocks.recordAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("api/declarations/next", () => {
  it("serves a reader without an account by their reader id, within the day's room for them", async () => {
    mocks.request.headers = { "x-reader-id": READER };

    expect(await next({} as never)).toBe(QUEUE);
    expect(mocks.admitToQueue.mock.calls[0]![1]).toEqual({
      uid: STRANGER,
      votes: false,
      anonymous: true,
    });
    expect(mocks.queueFor.mock.calls[0]!.slice(1, 3)).toEqual([STRANGER, 3]);
  });

  it("serves an account without a confirmed address", async () => {
    mocks.getUser.mockResolvedValue(UNCONFIRMED);

    expect(await next({} as never)).toBe(QUEUE);
    expect(mocks.admitToQueue.mock.calls[0]![1]).toMatchObject({
      votes: false,
    });
    expect(mocks.queueFor.mock.calls[0]![1]).toBe("unconfirmed");
  });

  it("serves nothing once the day's room for readers without a vote is used up", async () => {
    mocks.request.headers = { "x-reader-id": READER };
    mocks.admitToQueue.mockRejectedValueOnce(
      Object.assign(new Error("Na dziś przyjęliśmy już tyle odczytów"), {
        statusCode: 429,
      }),
    );

    await expect(next({} as never)).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.queueFor).not.toHaveBeenCalled();
  });

  it("takes ten crops at most as held by the page", async () => {
    const ids = Array.from(
      { length: 12 },
      (_, i) => `${String(i).padStart(64, "0")}-p0`,
    );
    mocks.request.query = { count: "3", exclude: [...ids, "nope"].join(",") };

    await next({} as never);

    expect([...mocks.queueFor.mock.calls[0]![3]]).toEqual(ids.slice(0, 10));
  });

  it("refuses a request with neither a token nor a reader id", async () => {
    mocks.request.headers = {};

    await expect(next({} as never)).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.queueFor).not.toHaveBeenCalled();
  });
});

describe("api/declarations/found", () => {
  const FINDS = { people: [], total: 0 };

  beforeEach(() => {
    mocks.findsOf.mockResolvedValue(FINDS);
  });

  it("lists whom the token's account found, never from a cache", async () => {
    expect(await found({} as never)).toBe(FINDS);
    expect(mocks.findsOf.mock.calls[0]![1]).toBe("reader");
    expect(globalThis.setResponseHeader).toHaveBeenCalledWith(
      {},
      "Cache-Control",
      "private, no-store",
    );
  });

  it("shows a browser's reader id nobody: whom it found waits for an account", async () => {
    mocks.request.headers = { "x-reader-id": READER };
    // As the real `getUser` answers a request without a token.
    mocks.getUser.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
    );

    await expect(found({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.findsOf).not.toHaveBeenCalled();
  });
});

describe("api/declarations/claim", () => {
  beforeEach(() => {
    mocks.body = { readerId: READER.toUpperCase() };
    mocks.claimAnswers.mockResolvedValue({ claimed: 0, settled: [] });
  });

  it("refuses a claim without a token", async () => {
    // The real lookup, which is what a request without a token meets.
    const { getUser } = await vi.importActual<
      typeof import("../../../../server/utils/auth")
    >("../../../../server/utils/auth");
    mocks.getUser.mockImplementation(getUser);
    mocks.request.headers = { "x-reader-id": READER };

    await expect(claim({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.claimAnswers).not.toHaveBeenCalled();
  });

  it("refuses a reader id that is not one", async () => {
    mocks.body = { readerId: `anon:${READER}` };
    await expect(claim({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    mocks.body = {};
    await expect(claim({} as never)).rejects.toThrow();

    expect(mocks.claimAnswers).not.toHaveBeenCalled();
  });

  it("claims for the account and compares the crops it settled on a day", async () => {
    mocks.claimAnswers.mockResolvedValue({
      claimed: 3,
      settled: [
        { extractId: "day", settlement: ON_A_DAY },
        {
          extractId: "year",
          settlement: { status: "agreed", value: "1979", kind: "year" },
        },
        { extractId: "unreadable", settlement: { status: "unreadable" } },
      ],
    });

    expect(await claim({} as never)).toEqual({ claimed: 3, settled: 3 });

    expect(mocks.claimAnswers.mock.calls[0]![1]).toMatchObject({
      readerId: READER,
      user: { uid: "reader" },
    });
    const [, ids, , limit, options] = mocks.matchAndDrain.mock.calls[0]!;
    expect(ids).toEqual(["day"]);
    expect(limit).toBe(4);
    expect(options).toEqual({ maxPages: 1 });
  });

  it("compares ten crops at most, and leaves the rest to the sweep", async () => {
    mocks.claimAnswers.mockResolvedValue({
      claimed: 12,
      settled: Array.from({ length: 12 }, (_, i) => ({
        extractId: `day-${i}`,
        settlement: ON_A_DAY,
      })),
    });

    await claim({} as never);

    expect(mocks.matchAndDrain.mock.calls[0]![1]).toHaveLength(10);
  });

  /** A database that answers every query with `docs` and has nothing else:
   * all the real claim reads for an account without a vote, which looks for
   * a reading under the browser's id before it says anything. */
  type Lookup = {
    where: () => Lookup;
    limit: () => Lookup;
    get: () => Promise<{ empty: boolean; docs: unknown[] }>;
  };
  function answering(docs: unknown[]) {
    const lookup: Lookup = {
      where: () => lookup,
      limit: () => lookup,
      get: async () => ({ empty: docs.length === 0, docs }),
    };
    return { collection: () => lookup };
  }

  async function realClaim() {
    const { claimAnswers } = await vi.importActual<
      typeof import("../../../../server/utils/declarations")
    >("../../../../server/utils/declarations");
    mocks.claimAnswers.mockImplementation(claimAnswers);
  }

  it("refuses an account without a confirmed address before anything moves, so the page keeps the id", async () => {
    // The real claim, on a browser with a reading to move: it reads that
    // much and no more, and moving anything would fail on this database.
    await realClaim();
    mocks.getUser.mockResolvedValue(UNCONFIRMED);
    mocks.db = answering([{ id: "a-reading" }]);

    await expect(claim({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
  });

  it("answers 0 to an account without a confirmed address for a browser that only looked, so the page forgets the id", async () => {
    await realClaim();
    mocks.getUser.mockResolvedValue(UNCONFIRMED);
    mocks.db = answering([]);

    expect(await claim({} as never)).toEqual({ claimed: 0, settled: 0 });
    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
  });

  it("answers 0 when there is nothing to claim", async () => {
    expect(await claim({} as never)).toEqual({ claimed: 0, settled: 0 });
    expect(mocks.matchAndDrain).not.toHaveBeenCalled();
  });
});

describe("api/declarations/sweep", () => {
  it("is the job's, not a reader's", async () => {
    await expect(sweep({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.sweepDeclarations).not.toHaveBeenCalled();
  });

  it("sweeps under the configured limit and says what it did", async () => {
    mocks.getUser.mockResolvedValue({
      uid: "pipeline-bip-declarations",
      datascience: true,
    });
    const done = { checked: 2, changed: 1, drain: { published: ["kowalska"] } };
    mocks.sweepDeclarations.mockResolvedValue(done);

    expect(await sweep({} as never)).toBe(done);
    expect(mocks.sweepDeclarations.mock.calls[0]![2]).toBe(4);
    expect(mocks.clear).toHaveBeenCalledWith("nitro:handlers");
  });
});

describe("api/declarations/publish-queued", () => {
  it("is an admin's", async () => {
    mocks.requireAdmin.mockRejectedValue(
      Object.assign(new Error("admins only"), { statusCode: 403 }),
    );
    await expect(publishQueued({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.drainPublications).not.toHaveBeenCalled();
  });

  it("hands the configured limit on, and answers what the pass did", async () => {
    mocks.requireAdmin.mockResolvedValue({ uid: "admin", admin: true });
    const done = { published: [], held: [], skipped: null, waiting: 3 };
    mocks.drainPublications.mockResolvedValue(done);

    expect(await publishQueued({} as never)).toBe(done);
    expect(mocks.drainPublications.mock.calls[0]![2]).toBe(4);
    // Nobody went up, so the cached pages stay.
    expect(mocks.clear).not.toHaveBeenCalledWith("nitro:handlers");
  });

  it("presses past the limit in the name of the admin, a batch at most", async () => {
    mocks.requireAdmin.mockResolvedValue({ uid: "admin", admin: true });
    mocks.drainPublications.mockResolvedValue({ published: ["kowalska"] });

    await publishQueued({} as never);

    expect(mocks.drainPublications.mock.calls[0]![3]).toEqual({
      pressedBy: "admin",
      maxPages: PRESS_BATCH,
    });
    expect(mocks.clear).toHaveBeenCalledWith("nitro:handlers");
  });
});

describe("the daily limit, as the endpoints read it", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockResolvedValue({ uid: "admin", admin: true });
    mocks.drainPublications.mockResolvedValue({ published: [] });
  });

  it("takes NUXT_DECLARATIONS_DAILY_PUBLISH_LIMIT as a string too", async () => {
    // What an environment override can arrive as.
    configure("4");
    await publishQueued({} as never);
    expect(mocks.drainPublications.mock.calls[0]![2]).toBe(4);
  });

  it("is off where the config says nothing", async () => {
    configure(undefined);
    await publishQueued({} as never);
    expect(mocks.drainPublications.mock.calls[0]![2]).toBe(0);
  });

  it("ships at DAILY_AUTO_PUBLISH_LIMIT", () => {
    // Read as text: loading the config would load Nuxt. The key is the one
    // the endpoints read, and NUXT_DECLARATIONS_DAILY_PUBLISH_LIMIT maps to
    // it, so a rename shows up here and not on a day nothing is published.
    // From the working directory: `import.meta.url` is not a file url under
    // the Nuxt test environment.
    const path = existsSync(resolve(process.cwd(), "nuxt.config.ts"))
      ? resolve(process.cwd(), "nuxt.config.ts")
      : resolve(process.cwd(), "frontend", "nuxt.config.ts");
    expect(DAILY_AUTO_PUBLISH_LIMIT).toBe(50);
    expect(readFileSync(path, "utf8")).toMatch(
      new RegExp(
        `^\\s+declarationsDailyPublishLimit: ${DAILY_AUTO_PUBLISH_LIMIT},$`,
        "m",
      ),
    );
  });
});
