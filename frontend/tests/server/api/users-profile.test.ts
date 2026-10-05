import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OwnProfileSettings } from "../../../shared/userAdmin";
import { FakeFirestore } from "../fakeFirestore";
import getHandler from "../../../server/api/users/profile.get";
import postHandler from "../../../server/api/users/profile/handle.post";

const firestore = vi.hoisted(() => ({ db: undefined as unknown }));

const { mockGetUser, mockAuthGetUser, headers } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);

  return {
    mockGetUser: vi.fn(),
    mockAuthGetUser: vi.fn(),
    headers: new Map<string, string>(),
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    // As h3 does: whatever the validator throws becomes a 400.
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => {
      try {
        return parser(event.body);
      } catch (error) {
        throw Object.assign(new Error("Validation Error"), {
          statusCode: 400,
          data: error,
        });
      }
    },
    setResponseHeader: (_event: unknown, name: string, value: string) =>
      headers.set(name, value),
  };
});

// `getFirestore` is called when a handler runs, not when it is imported, so
// the box is filled by then.
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => firestore.db,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: mockAuthGetUser }),
}));

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

const fake = new FakeFirestore();
firestore.db = fake;

const unauthenticated = () =>
  Object.assign(new Error("Błąd uwierzytelniania"), { statusCode: 401 });

const get = () =>
  (getHandler as unknown as (e: unknown) => Promise<OwnProfileSettings>)({});
const post = (body: unknown) =>
  (postHandler as unknown as (e: unknown) => Promise<OwnProfileSettings>)({
    body,
  });

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  headers.clear();
  mockGetUser.mockResolvedValue({ uid: "u1", name: "Token Name" });
  mockAuthGetUser.mockResolvedValue({ uid: "u1", displayName: "Anna Nowak" });
});

describe("GET /api/users/profile", () => {
  it("needs a signed-in caller", async () => {
    mockGetUser.mockRejectedValue(unauthenticated());

    await expect(get()).rejects.toMatchObject({ statusCode: 401 });
    expect(fake.getAllCalls).toEqual([]);
  });

  it("gives an account that opted in a handle from its current name", async () => {
    fake.seed("users/u1", { publicProfile: true });

    const settings = await get();

    expect(settings).toEqual({
      publicProfile: true,
      handle: "anna-nowak",
      path: "/uczestnik/anna-nowak",
      hidden: false,
      avatar: null,
    });
    // The account's name now, not the one the token was issued with.
    expect(mockAuthGetUser).toHaveBeenCalledWith("u1");
    expect(fake.read("profileHandles/anna-nowak")).toMatchObject({
      uid: "u1",
    });
  });

  it("falls back to the token's name when the account cannot be read", async () => {
    fake.seed("users/u1", { publicProfile: true });
    mockAuthGetUser.mockRejectedValue(new Error("auth is down"));

    expect((await get()).handle).toBe("token-name");
  });

  it("assigns nothing while the switch is off", async () => {
    fake.seed("users/u1", { publicProfile: false });

    expect(await get()).toMatchObject({
      publicProfile: false,
      handle: null,
      path: null,
    });
    expect(mockAuthGetUser).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it("says when an administrator hid the profile", async () => {
    fake.seed("users/u1", { publicProfile: true });
    fake.seed("profiles/u1", {
      handle: "anna-nowak",
      avatarImageId: "img1",
      hidden: { by: "admin", at: "2026-10-05T00:00:00.000Z", reason: "spam" },
    });

    expect(await get()).toEqual({
      publicProfile: true,
      handle: "anna-nowak",
      path: null,
      hidden: true,
      avatar: "/api/images/img1",
    });
  });

  it("is the caller's alone", async () => {
    await get();

    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/users/profile/handle", () => {
  beforeEach(() => {
    fake.seed("users/u1", { publicProfile: true });
    fake.seed("profiles/u1", {
      handle: "anna-nowak",
      avatarImageId: null,
      hidden: null,
    });
    fake.seed("profileHandles/anna-nowak", {
      uid: "u1",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("needs a signed-in caller", async () => {
    mockGetUser.mockRejectedValue(unauthenticated());

    await expect(post({ handle: "ania" })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(fake.writes).toEqual([]);
  });

  it("moves the caller to the handle they chose", async () => {
    const settings = await post({ handle: "  Ania-Z-Krakowa " });

    expect(settings).toMatchObject({
      handle: "ania-z-krakowa",
      path: "/uczestnik/ania-z-krakowa",
    });
    expect(fake.read("profileHandles/ania-z-krakowa")).toMatchObject({
      uid: "u1",
    });
    expect(fake.read("profileHandles/anna-nowak")).toBeUndefined();
    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    ["too short", "ab"],
    ["too long", "a".repeat(31)],
    ["Polish letters", "łukasz"],
    ["a space inside", "anna nowak"],
    ["a hyphen at the end", "anna-"],
    ["two hyphens in a row", "anna--nowak"],
    ["a word the site speaks with", "redakcja"],
    ["not a string", 42],
  ])("refuses a handle with %s", async (_, handle) => {
    await expect(post({ handle })).rejects.toMatchObject({ statusCode: 400 });
    expect(fake.writes).toEqual([]);
  });

  it("refuses a body without a handle", async () => {
    await expect(post({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a handle somebody else holds", async () => {
    fake.seed("profileHandles/bartek", {
      uid: "u2",
      createdAt: "2026-10-01T00:00:00.000Z",
    });

    await expect(post({ handle: "bartek" })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("stops after the day's changes", async () => {
    fake.seed("profiles/u1", {
      handle: "anna-nowak",
      avatarImageId: null,
      hidden: null,
      handleChanges: {
        day: new Date().toISOString().slice(0, 10),
        count: 5,
      },
    });

    await expect(post({ handle: "ania" })).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("does not give a robot a profile", async () => {
    mockGetUser.mockResolvedValue({ uid: "pipeline-people-import" });

    await expect(post({ handle: "robot" })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(fake.writes).toEqual([]);
  });
});
