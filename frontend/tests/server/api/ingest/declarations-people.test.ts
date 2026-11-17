import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/ingest/declarations/people.post";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "../../../../scripts/declarationPeople";

const { mockGetUser, mockSet, mockDoc, mockCacheClear } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  const mockCacheClear = vi.fn();
  globalThis.useStorage = vi.fn(() => ({ clear: mockCacheClear }));
  const mockSet = vi.fn();
  return {
    mockGetUser: vi.fn(),
    mockSet,
    mockDoc: vi.fn(() => ({ set: mockSet })),
    mockCacheClear,
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => ({ doc: mockDoc }) }),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/utils/auth")>()),
  getUser: mockGetUser,
}));

let body: unknown = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).readValidatedBody = async (_event: unknown, parse: any) =>
  parse(body);

describe("api/ingest/declarations/people", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      uid: "pipeline-declarations",
      datascience: true,
    });
    body = structuredClone(seeded);
  });

  it("stores the night's count whole and drops the cached one", async () => {
    // Anything the contract does not name is left behind.
    body = { ...structuredClone(seeded), heldBy: [] };

    expect(await handler({} as never)).toEqual({
      status: "ok",
      people: seeded.people,
      exportDay: seeded.exportDay,
    });
    expect(mockDoc).toHaveBeenCalledWith("declaration_people");
    expect(mockSet).toHaveBeenCalledWith(seeded);
    expect(mockCacheClear).toHaveBeenCalledWith(
      "nitro:handlers:declarations-people",
    );
  });

  it("is the job's, not anybody signed in", async () => {
    mockGetUser.mockResolvedValue({ uid: "reader" });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("refuses a count whose stages do not add up, and keeps the last one", async () => {
    body = { ...structuredClone(seeded), published: seeded.published + 1 };

    await expect(handler({} as never)).rejects.toThrow(/add up/);
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockCacheClear).not.toHaveBeenCalled();
  });
});
