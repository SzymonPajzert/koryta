import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PublicProfile } from "../../../shared/userAdmin";
import { FakeFirestore } from "../fakeFirestore";
import profileHandler from "../../../server/api/profiles/[handle].get";

const firestore = vi.hoisted(() => ({ db: undefined as unknown }));

const { mockAuthGetUser, headers, cachedOptions } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  const cachedOptions: Record<string, unknown>[] = [];
  // Nitro memoizes the counts; here the memo runs straight through, and what
  // it was asked to hold for is kept for the test that checks it.
  g.defineCachedFunction = (fn: unknown, options: Record<string, unknown>) => {
    cachedOptions.push(options);
    return fn;
  };

  return {
    mockAuthGetUser: vi.fn(),
    headers: new Map<string, string>(),
    cachedOptions,
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getRouterParam: (
      event: { params?: Record<string, string> },
      name: string,
    ) => event.params?.[name],
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

const fake = new FakeFirestore();
firestore.db = fake;

const handler = profileHandler as unknown as (
  event: unknown,
) => Promise<PublicProfile>;

const open = (handle: string, headers: Record<string, string> = {}) =>
  handler({ params: { handle }, headers });

const account = (fields: Record<string, unknown> = {}) => ({
  uid: "u1",
  displayName: "Anna Nowak",
  email: "anna@example.com",
  // What Google hands out, and what must never reach a public page.
  photoURL: "https://lh3.googleusercontent.com/a/anna",
  disabled: false,
  metadata: { creationTime: "Wed, 06 May 2026 09:30:00 GMT" },
  ...fields,
});

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  headers.clear();
  fake.seed("profileHandles/anna-nowak", {
    uid: "u1",
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  fake.seed("users/u1", { publicProfile: true, displayName: "<script>" });
  fake.seed("profiles/u1", {
    handle: "anna-nowak",
    avatarImageId: null,
    hidden: null,
  });
  mockAuthGetUser.mockResolvedValue(account());
});

describe("GET /api/profiles/[handle]", () => {
  it("shows the name, the month joined and what the person did", async () => {
    fake.seed("votes/a_u1", { userUid: "u1" });
    fake.seed("votes/b_u1", { userUid: "u1" });
    fake.seed("notes/a_u1", { userUid: "u1" });
    fake.seed("revisions/r1", {
      update_user: "u1",
      update_automatic: false,
      status: "approved",
    });
    fake.seed("revisions/r2", {
      update_user: "u1",
      update_automatic: false,
      status: "rejected",
    });

    expect(await open("anna-nowak")).toEqual({
      handle: "anna-nowak",
      name: "Anna Nowak",
      avatar: null,
      joined: "2026-05",
      counts: { votes: 2, notes: 1, proposals: 2, accepted: 1 },
    });
  });

  it("hands out no uid, address or outside picture", async () => {
    const body = JSON.stringify(await open("anna-nowak"));

    for (const secret of ["u1", "anna@example.com", "googleusercontent"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("shows only the picture the site itself stored", async () => {
    fake.seed("profiles/u1", {
      handle: "anna-nowak",
      avatarImageId: "img123",
      hidden: null,
    });

    expect((await open("anna-nowak")).avatar).toBe("/api/images/img123");
  });

  it("heads a profile with no name neutrally, never with its handle", async () => {
    // The handle was cut from a name; once an administrator has taken the name
    // down, a heading made of the handle would put it back.
    for (const displayName of ["  ", undefined]) {
      mockAuthGetUser.mockResolvedValue(account({ displayName }));

      expect((await open("anna-nowak")).name).toBe("Uczestnik");
    }
  });

  it("reads the switch with a mask, never the whole user document", async () => {
    await open("anna-nowak");

    const usersRead = fake.getAllCalls.find((call) =>
      call.paths.includes("users/u1"),
    );
    expect(usersRead?.fieldMask).toEqual(["publicProfile"]);
  });

  it("may be kept by a cache for a minute, whoever asks", async () => {
    const anonymous = await open("anna-nowak");
    const signedIn = await open("anna-nowak", {
      authorization: "Bearer admin-token",
    });

    expect(signedIn).toEqual(anonymous);
    expect(headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("memoizes the counts per account for five minutes", () => {
    const counts = cachedOptions.find((o) => o.name === "profile-counts");

    expect(counts).toMatchObject({ maxAge: 300 });
    expect((counts!.getKey as (uid: string) => string)("u1")).toBe("u1");
  });

  describe("is not found", () => {
    const notFound = async (handle = "anna-nowak") => {
      await expect(open(handle)).rejects.toMatchObject({ statusCode: 404 });
      expect(headers.get("Cache-Control")).toBe("no-store");
    };

    it("for a handle nobody holds", async () => {
      await notFound("bartek");
    });

    it("for something that is not a handle at all", async () => {
      await notFound("Anna-Nowak");
      await notFound("../users/u1");
      // Not looked up: nothing that fails the pattern reaches Firestore.
      expect(fake.reads).toEqual([]);
    });

    it("for a uid in place of a handle", async () => {
      await notFound("u1");
    });

    it("once the owner switched the profile off", async () => {
      fake.seed("users/u1", { publicProfile: false });

      await notFound();
    });

    it("for an owner who never switched it on", async () => {
      fake.docs.delete("users/u1");

      await notFound();
    });

    it("while an administrator keeps it hidden", async () => {
      fake.seed("profiles/u1", {
        handle: "anna-nowak",
        avatarImageId: null,
        hidden: { by: "a1", at: "2026-10-05T00:00:00.000Z", reason: "spam" },
      });

      await notFound();
    });

    it("for a handle its owner has since moved away from", async () => {
      // The profile says otherwise: the document is left over.
      fake.seed("profiles/u1", {
        handle: "ania",
        avatarImageId: null,
        hidden: null,
      });

      await notFound();
    });

    it("for an account that is gone or disabled", async () => {
      mockAuthGetUser.mockRejectedValue(
        Object.assign(new Error("gone"), { code: "auth/user-not-found" }),
      );
      await notFound();

      mockAuthGetUser.mockResolvedValue(account({ disabled: true }));
      await notFound();
    });

    it("for a robot", async () => {
      fake.seed("profileHandles/robot", {
        uid: "pipeline-people-import",
        createdAt: "2026-10-01T00:00:00.000Z",
      });
      fake.seed("users/pipeline-people-import", { publicProfile: true });
      fake.seed("profiles/pipeline-people-import", {
        handle: "robot",
        avatarImageId: null,
        hidden: null,
      });

      await notFound("robot");
    });
  });
});
