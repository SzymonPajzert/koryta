import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../../server/api/ingest/declarations/facts.post";

/** The endpoint the night sends predator's facts to: the gate, the contract,
 * the refusal of older facts, and what it hands to the count, which
 * tests/server/utils/declarationPeopleCount.test.ts runs. */
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return {
    body: {} as unknown,
    readBody: vi.fn(),
    getUser: vi.fn(),
    count: vi.fn(),
    /** What `declarationPeople/meta` holds. */
    meta: undefined as Record<string, unknown> | undefined,
  };
});

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

const db = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        data: () =>
          name === "declarationPeople" && id === "meta"
            ? mocks.meta
            : undefined,
      }),
    }),
  }),
};

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => db }));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("../../../../server/utils/auth", async (original) => ({
  ...(await original<typeof import("../../../../server/utils/auth")>()),
  getUser: mocks.getUser,
}));
vi.mock(
  "../../../../server/utils/declarationPeopleCount",
  async (original) => ({
    ...(await original<
      typeof import("../../../../server/utils/declarationPeopleCount")
    >()),
    countDeclarationPeople: mocks.count,
  }),
);

const FACT = {
  key: "f23a52f46489f75f",
  kids: ["kowalska"],
  teryt: "021704",
  unitName: "Strzelin (gmina miejsko-wiejska)",
  year: 2024,
  status: "not_found",
  reason: "unreachable",
  uncut: false,
  cutNamed: false,
  waiting: false,
  bearers: 6000,
};

const BODY = {
  generation: "2026-11-17T05:40:00.000Z",
  listAt: null,
  part: "gs://koryta-pl-sharedcache/jobs/bip_declarations/facts/date=2026-11-17/2026-11-17T051500Z.jsonl.gz",
  partAt: "2026-11-17T05:15:00.000Z",
  candidacies: [FACT],
};

const COUNTED = {
  status: "ok",
  people: 1,
  stages: {
    published: 0,
    namesakes: 0,
    mismatched: 0,
    held: 0,
    reading: 0,
    cropped: 0,
    downloaded: 0,
    searching: 1,
  },
  unknownReasons: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    uid: "pipeline-declarations",
    datascience: true,
  });
  mocks.count.mockResolvedValue(COUNTED);
  mocks.body = structuredClone(BODY);
  mocks.meta = undefined;
});

describe("api/ingest/declarations/facts", () => {
  it("counts the night's facts, and leaves out what the contract does not name", async () => {
    mocks.body = {
      ...structuredClone(BODY),
      candidacies: [{ ...FACT, name: "Anna Kowalska" }],
    };

    expect(await handler({} as never)).toBe(COUNTED);
    const [handed, body, now] = mocks.count.mock.calls[0]!;
    expect(handed).toBe(db);
    expect(body).toEqual(BODY);
    expect(now).toBeInstanceOf(Date);
  });

  it("is the night's, checked before the body is read", async () => {
    mocks.getUser.mockResolvedValue({ uid: "reader" });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.readBody).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("refuses a body that breaks the contract", async () => {
    for (const fact of [
      { ...FACT, key: "Kowalska" },
      { ...FACT, kids: [] },
      { ...FACT, kids: ["a", "b", "c", "d", "e", "f"] },
      { ...FACT, teryt: "21704" },
      { ...FACT, status: "maybe" },
      { ...FACT, reason: "x".repeat(41) },
      { ...FACT, bearers: -1 },
    ]) {
      mocks.body = { ...structuredClone(BODY), candidacies: [fact] };
      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
    }
    mocks.body = { ...structuredClone(BODY), generation: "2026-11-17 05:40" };
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("refuses facts older than the ones counted, unless forced", async () => {
    mocks.meta = { generation: "2026-11-17T07:00:00.000Z" };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.count).not.toHaveBeenCalled();

    mocks.body = { ...structuredClone(BODY), force: true };
    expect(await handler({} as never)).toBe(COUNTED);
    expect(mocks.count).toHaveBeenCalledTimes(1);
  });
});
