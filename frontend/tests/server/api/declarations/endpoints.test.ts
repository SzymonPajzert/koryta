import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRuntimeConfig } from "#app";
import answer from "../../../../server/api/declarations/[id]/answer.post";
import sweep from "../../../../server/api/declarations/sweep.post";
import publishQueued from "../../../../server/api/declarations/publish-queued.post";

/** What the three endpoints hand to server/utils/declarationPublish.ts, which
 * is tested on its own: the crop an answer settles, the configured limit, and
 * the gate in front of each. The limit is read from the runtime config the
 * way the site reads it (`publishLimitOf`), not handed in by a mock. */
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.getRouterParam = () => `${"a".repeat(64)}-p0`;
  globalThis.setResponseHeader = vi.fn();
  const clear = vi.fn();
  globalThis.useStorage = vi.fn(() => ({ clear }));
  return {
    body: {} as unknown,
    clear,
    getUser: vi.fn(),
    requireAdmin: vi.fn(),
    recordAnswer: vi.fn(),
    queueFor: vi.fn(),
    matchAndDrain: vi.fn(),
    sweepDeclarations: vi.fn(),
    drainPublications: vi.fn(),
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

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
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
}));
vi.mock("../../../../server/utils/declarationPublish", () => ({
  matchAndDrain: mocks.matchAndDrain,
  sweepDeclarations: mocks.sweepDeclarations,
  drainPublications: mocks.drainPublications,
}));

const ID = `${"a".repeat(64)}-p0`;
const QUEUE = {
  task: null,
  upcoming: [],
  open: 0,
  mine: { today: 1, total: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  configure(4);
  mocks.getUser.mockResolvedValue({
    uid: "reader",
    email_verified: true,
    firebase: { sign_in_provider: "password" },
  });
  mocks.queueFor.mockResolvedValue(QUEUE);
  mocks.matchAndDrain.mockResolvedValue({
    matched: [],
    drain: { published: [] },
  });
  mocks.body = { verdict: "date", value: "1979-07-15" };
});

function settles(settled: unknown) {
  mocks.recordAnswer.mockResolvedValue({
    settled,
    documentUrl: "https://bip.strzelin.pl/download/1",
    host: "bip.strzelin.pl",
  });
}

describe("api/declarations/[id]/answer", () => {
  it("compares a crop it settles on a day with its pages, one page of the queue at most", async () => {
    settles({
      status: "agreed",
      value: "1979-07-15",
      kind: "date",
      readers: 2,
    });

    const result = await answer({} as never);

    expect(result).toMatchObject({ settled: true, answered: { id: ID } });
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
    settles({
      status: "agreed",
      value: "1979-07-15",
      kind: "date",
      readers: 2,
    });
    mocks.matchAndDrain.mockRejectedValueOnce(new Error("contention"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const result = await answer({} as never);

    expect(result).toMatchObject({ ...QUEUE, settled: true });
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

  it("takes up the queue under the configured limit", async () => {
    mocks.requireAdmin.mockResolvedValue({ uid: "admin", admin: true });
    const done = { published: [], held: [], skipped: "off" };
    mocks.drainPublications.mockResolvedValue(done);

    expect(await publishQueued({} as never)).toBe(done);
    expect(mocks.drainPublications.mock.calls[0]![2]).toBe(4);
    expect(mocks.clear).not.toHaveBeenCalled();
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

  it("ships at 0", () => {
    // Read as text: loading the config would load Nuxt. The key is the one
    // the endpoints read, and NUXT_DECLARATIONS_DAILY_PUBLISH_LIMIT maps to
    // it, so a rename shows up here and not on the day the limit is set.
    // From the working directory: `import.meta.url` is not a file url under
    // the Nuxt test environment.
    const path = existsSync(resolve(process.cwd(), "nuxt.config.ts"))
      ? resolve(process.cwd(), "nuxt.config.ts")
      : resolve(process.cwd(), "frontend", "nuxt.config.ts");
    expect(readFileSync(path, "utf8")).toMatch(
      /^\s+declarationsDailyPublishLimit: 0,$/m,
    );
  });
});
