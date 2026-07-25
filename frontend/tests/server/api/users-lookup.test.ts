import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/users/lookup.get";

const { mockGetUsers, mockGetUser } = vi.hoisted(() => {
  // Nitro auto-imports createError in server handlers; stub it for tests.
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);

  return {
    mockGetUsers: vi.fn(),
    mockGetUser: vi.fn(),
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query: unknown },
      parser: (q: unknown) => unknown,
    ) => parser(event.query),
  };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: mockGetUsers }),
}));

vi.mock("~~/server/utils/auth", () => ({
  getUser: mockGetUser,
}));

const callHandler = (uids: string) =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({
    query: { uids },
  });

describe("/api/users/lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUsers.mockResolvedValue({ users: [], notFound: [] });
  });

  it("rejects callers without the admin claim", async () => {
    mockGetUser.mockResolvedValue({ uid: "user-1" });

    await expect(callHandler("some-uid")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockGetUsers).not.toHaveBeenCalled();
  });

  it("resolves display data for admins", async () => {
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
    mockGetUsers.mockResolvedValue({
      users: [
        {
          uid: "u1",
          displayName: "Jan Kowalski",
          email: "jan@example.com",
          photoURL: "https://example.com/jan.png",
        },
      ],
      notFound: [{ uid: "u2" }],
    });

    const result = (await callHandler("u1,u2")) as {
      users: Record<string, unknown>;
    };

    expect(mockGetUsers).toHaveBeenCalledWith([{ uid: "u1" }, { uid: "u2" }]);
    expect(result.users["u1"]).toEqual({
      displayName: "Jan Kowalski",
      email: "jan@example.com",
      photoURL: "https://example.com/jan.png",
    });
    // Unknown uids are simply absent, the client falls back to the raw uid.
    expect(result.users["u2"]).toBeUndefined();
  });

  it("deduplicates uids and skips empty entries", async () => {
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });

    await callHandler("u1,,u1,u3");

    expect(mockGetUsers).toHaveBeenCalledWith([{ uid: "u1" }, { uid: "u3" }]);
  });

  it("rejects requests with more than 100 uids", async () => {
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
    const uids = Array.from({ length: 101 }, (_, i) => `u${i}`).join(",");

    await expect(callHandler(uids)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockGetUsers).not.toHaveBeenCalled();
  });

  it("fills in nulls for users without display data", async () => {
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
    mockGetUsers.mockResolvedValue({
      users: [{ uid: "u1" }],
      notFound: [],
    });

    const result = (await callHandler("u1")) as {
      users: Record<string, unknown>;
    };

    expect(result.users["u1"]).toEqual({
      displayName: null,
      email: null,
      photoURL: null,
    });
  });
});
