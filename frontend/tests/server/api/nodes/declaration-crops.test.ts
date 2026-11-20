import { describe, it, expect, vi, beforeEach } from "vitest";
import crops from "../../../../server/api/nodes/[id]/declaration-crops.get";
import links from "../../../../server/api/nodes/[id]/declaration-links.post";

/** The two endpoints of a draft's declarations block: the gate in front of
 * each, the draft they answer for, the body a link comes in, and that
 * nothing caches the block. What they hand to
 * server/utils/declarationPersonCrops.ts is tested there. */
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  const state = { id: "kowalska" as string | undefined, body: {} as unknown };
  globalThis.getRouterParam = () => state.id;
  const setHeader = vi.fn();
  globalThis.setResponseHeader = setHeader;
  const readBody = vi.fn();
  (globalThis as Record<string, unknown>).readValidatedBody = async (
    _event: unknown,
    parse: (raw: unknown) => unknown,
  ) => {
    readBody();
    return parse(state.body);
  };
  return {
    state,
    setHeader,
    readBody,
    getUser: vi.fn(),
    draftPerson: vi.fn(),
    personDeclarationCrops: vi.fn(),
    addDeclarationLink: vi.fn(),
  };
});

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("../../../../server/utils/auth", () => ({ getUser: mocks.getUser }));
vi.mock("../../../../server/utils/declarationPersonCrops", () => ({
  draftPerson: mocks.draftPerson,
  personDeclarationCrops: mocks.personDeclarationCrops,
  addDeclarationLink: mocks.addDeclarationLink,
}));

const call = (handler: unknown) =>
  (handler as (event: never) => Promise<unknown>)({} as never);

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { statusCode?: number; message: string };
  }
  throw new Error("expected the call to throw");
}

const ANSWER = { publication: null, crops: [], searches: [], links: [] };
const URL = "https://bip.strzelin.pl/rada/kowalska.pdf";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.id = "kowalska";
  mocks.state.body = { url: URL };
  mocks.getUser.mockResolvedValue({ uid: "reader", admin: false });
  mocks.draftPerson.mockImplementation(async (_db, id: string) => id);
  mocks.personDeclarationCrops.mockResolvedValue(ANSWER);
  mocks.addDeclarationLink.mockResolvedValue("added");
});

const notSignedIn = () =>
  mocks.getUser.mockRejectedValue(
    Object.assign(new Error("Proszę się zalogować."), { statusCode: 401 }),
  );

describe("api/nodes/[id]/declaration-crops", () => {
  it("answers any signed-in reader of a draft, never to be cached", async () => {
    await expect(call(crops)).resolves.toBe(ANSWER);
    expect(mocks.draftPerson).toHaveBeenCalledWith(
      expect.anything(),
      "kowalska",
    );
    expect(mocks.personDeclarationCrops).toHaveBeenCalledWith(
      expect.anything(),
      "kowalska",
      "reader",
    );
    expect(mocks.setHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "private, no-store",
    );
  });

  it("reads nothing for somebody who is not signed in", async () => {
    notSignedIn();
    expect((await failure(call(crops))).statusCode).toBe(401);
    expect(mocks.draftPerson).not.toHaveBeenCalled();
    expect(mocks.personDeclarationCrops).not.toHaveBeenCalled();
  });

  it("answers for the draft a merged page went into, and nothing for a page that is no draft", async () => {
    mocks.draftPerson.mockResolvedValueOnce("kowalska-2");
    await call(crops);
    expect(mocks.personDeclarationCrops).toHaveBeenCalledWith(
      expect.anything(),
      "kowalska-2",
      "reader",
    );

    mocks.personDeclarationCrops.mockClear();
    mocks.draftPerson.mockRejectedValueOnce(
      Object.assign(new Error("No draft"), { statusCode: 404 }),
    );
    expect((await failure(call(crops))).statusCode).toBe(404);
    expect(mocks.personDeclarationCrops).not.toHaveBeenCalled();
  });

  it("is a 400 without an id", async () => {
    mocks.state.id = undefined;
    expect((await failure(call(crops))).statusCode).toBe(400);
    expect(mocks.personDeclarationCrops).not.toHaveBeenCalled();
  });
});

describe("api/nodes/[id]/declaration-links", () => {
  it("stores a signed-in reader's link to a draft's declaration and answers with the block", async () => {
    await expect(call(links)).resolves.toBe(ANSWER);
    expect(mocks.addDeclarationLink).toHaveBeenCalledWith(expect.anything(), {
      personId: "kowalska",
      url: URL,
      uid: "reader",
    });
    expect(mocks.personDeclarationCrops).toHaveBeenCalledWith(
      expect.anything(),
      "kowalska",
      "reader",
    );
  });

  it("reads nothing, the body included, for somebody who is not signed in", async () => {
    notSignedIn();
    expect((await failure(call(links))).statusCode).toBe(401);
    expect(mocks.readBody).not.toHaveBeenCalled();
    expect(mocks.addDeclarationLink).not.toHaveBeenCalled();
  });

  it("refuses what is not a web address, trimming the one that is", async () => {
    for (const url of [
      "",
      "bip.strzelin.pl",
      "javascript:alert(1)",
      "ftp://bip.strzelin.pl/a",
      "https://localhost/a",
      `https://bip.strzelin.pl/${"a".repeat(2000)}`,
    ]) {
      mocks.state.body = { url };
      await expect(call(links)).rejects.toThrow();
    }
    expect(mocks.addDeclarationLink).not.toHaveBeenCalled();

    mocks.state.body = { url: `  ${URL}\n` };
    await call(links);
    expect(mocks.addDeclarationLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ url: URL }),
    );
  });

  it("stores nothing for a page that is no draft", async () => {
    mocks.draftPerson.mockRejectedValueOnce(
      Object.assign(new Error("No draft"), { statusCode: 404 }),
    );
    expect((await failure(call(links))).statusCode).toBe(404);
    expect(mocks.addDeclarationLink).not.toHaveBeenCalled();
  });
});
