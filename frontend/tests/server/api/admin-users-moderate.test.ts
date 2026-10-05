import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/admin/users/moderate.post";
import type { AdminUserRow } from "../../../shared/userAdmin";
import type { MemoryFirestore } from "./memoryFirestore";

const { mockVerifyIdToken, mockUpdateUser, accounts, memory } = vi.hoisted(
  () => {
    const g = globalThis as Record<string, unknown>;
    g.createError = (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts);
    g.getRequestHeader = (
      event: { headers?: Record<string, string> },
      name: string,
    ) => event.headers?.[name.toLowerCase()];
    // The row the route answers with is built by userDirectory, whose memos
    // are not what these tests are about.
    g.defineCachedFunction = (fn: unknown) => fn;

    return {
      mockVerifyIdToken: vi.fn(),
      mockUpdateUser: vi.fn(),
      /** The auth service's accounts, by uid. */
      accounts: new Map<string, Record<string, unknown>>(),
      memory: {} as { store: MemoryFirestore },
    };
  },
);

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    // h3 answers a body that fails its parser with a 400; so does this.
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => {
      try {
        return parser(event.body);
      } catch (error) {
        throw Object.assign(new Error("Validation Error"), {
          statusCode: 400,
          cause: error,
        });
      }
    },
  };
});

vi.mock("firebase-admin/firestore", async () => {
  const { createMemoryFirestore } =
    await vi.importActual<typeof import("./memoryFirestore")>(
      "./memoryFirestore",
    );
  memory.store = createMemoryFirestore();
  return memory.store.module;
});

// The real `requireEstablishedAdmin` runs: it reads the caller's token and
// then their account, which is what tells a trial administrator apart.
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
    updateUser: mockUpdateUser,
    getUser: async (uid: string) => {
      const account = accounts.get(uid);
      if (!account) {
        throw Object.assign(new Error("no user"), {
          code: "auth/user-not-found",
        });
      }
      return {
        uid,
        providerData: [],
        customClaims: {},
        metadata: { creationTime: "Mon, 01 Sep 2026 10:00:00 GMT" },
        ...account,
      };
    },
  }),
}));

vi.mock("~~/server/utils/activityWindow", () => ({
  cachedActivityWindow: async () => ({ aggregate: { contributors: [] } }),
}));

const TOKENS: Record<string, Record<string, unknown>> = {
  "admin-token": { uid: "admin", admin: true, datascience: true },
  "trial-token": { uid: "trial", admin: true, newAdmin: true },
  "user-token": { uid: "u1" },
  "owner-token": { uid: "owner", admin: true, owner: true },
};

type Event = { body?: unknown; headers?: Record<string, string> };
const moderate = (body: unknown, token: string | null = "admin-token") =>
  (handler as unknown as (e: Event) => Promise<AdminUserRow>)({
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const store = () => memory.store;
const doc = (path: string) => store().docs.get(path);
/** The `userActions` lines written, in order. */
const actions = () =>
  [...store().docs.entries()]
    .filter(([path]) => path.startsWith("userActions/"))
    .map(([, data]) => data);

const OWN_PICTURE = "https://koryta.pl/api/images/pic1";
const GOOGLE_PICTURE = "https://lh3.example/jan.jpg";

describe("POST /api/admin/users/moderate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store().reset();
    accounts.clear();
    mockVerifyIdToken.mockImplementation(async (token: string) => {
      const decoded = TOKENS[token];
      if (!decoded) throw new Error("bad token");
      return decoded;
    });
    // Auth keeps what it is told, so the row read back after the action shows
    // it.
    mockUpdateUser.mockImplementation(
      async (uid: string, fields: Record<string, unknown>) => {
        store().log.push(`auth ${uid}`);
        Object.assign(accounts.get(uid) ?? {}, fields);
        return {};
      },
    );
    accounts.set("admin", {
      customClaims: { admin: true, datascience: true, trusted: true },
    });
    accounts.set("trial", {
      customClaims: { admin: true, datascience: true, newAdmin: true },
    });
    accounts.set("owner", {
      customClaims: { admin: true, datascience: true, owner: true },
    });
    accounts.set("u1", {
      displayName: "Jan Testowy",
      photoURL: OWN_PICTURE,
      providerData: [{ providerId: "google.com", photoURL: GOOGLE_PICTURE }],
    });
    store().seed("images/pic1", { purpose: "avatar", subject: "users/u1" });
    store().seed("profiles/u1", {
      handle: "jan-testowy",
      avatarImageId: "pic1",
      hidden: null,
    });
    store().seed("users/u1", {
      displayName: "Jan Testowy",
      photoURL: OWN_PICTURE,
      publicProfile: true,
    });
  });

  const takeDown = {
    uid: "u1",
    action: "removeAvatar",
    reason: "Obraźliwe zdjęcie",
  };

  describe("who may", () => {
    it("needs a signed-in caller", async () => {
      await expect(moderate(takeDown, null)).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(store().log).toEqual([]);
    });

    it.each([
      ["somebody who is not an administrator", "user-token"],
      ["an administrator on trial", "trial-token"],
    ])("refuses %s", async (_, token) => {
      await expect(moderate(takeDown, token)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(store().log).toEqual([]);
    });

    // The token says established; the account, read now, says trial.
    it("refuses an administrator put on trial since their token was issued", async () => {
      accounts.set("admin", {
        customClaims: { admin: true, newAdmin: true },
      });

      await expect(moderate(takeDown)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("refuses to touch the owner's account for anybody but the owner", async () => {
      accounts.set("owner", {
        displayName: "Szymon",
        customClaims: { admin: true, owner: true },
      });

      await expect(
        moderate({ uid: "owner", action: "resetName", reason: "Test" }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockUpdateUser).not.toHaveBeenCalled();

      await moderate(
        { uid: "owner", action: "resetName", reason: "Test" },
        "owner-token",
      );
      expect(mockUpdateUser).toHaveBeenCalledWith("owner", {
        displayName: null,
      });
    });

    it("lets an administrator act on their own account", async () => {
      await moderate({
        uid: "admin",
        action: "hideProfile",
        reason: "Na razie bez profilu",
      });

      expect(doc("profiles/admin")?.hidden).toMatchObject({ by: "admin" });
    });
  });

  describe("what it takes", () => {
    it.each([
      ["no account", { action: "removeAvatar", reason: "Powód" }],
      ["an action it does not know", { ...takeDown, action: "ban" }],
      ["no reason", { uid: "u1", action: "removeAvatar" }],
      ["a reason too short to say anything", { ...takeDown, reason: " x " }],
      ["a reason past the limit", { ...takeDown, reason: "x".repeat(501) }],
    ])("refuses %s", async (_, body) => {
      await expect(moderate(body)).rejects.toMatchObject({ statusCode: 400 });
      expect(store().log).toEqual([]);
    });

    it("says so when there is no such account", async () => {
      await expect(
        moderate({ ...takeDown, uid: "nobody" }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(store().log).toEqual([]);
    });
  });

  describe("removeAvatar", () => {
    it("takes the picture down to the sign-in provider's, with the reason on record", async () => {
      const answer = await moderate(takeDown);

      expect(doc("images/pic1")).toBeUndefined();
      expect(doc("profiles/u1")?.avatarImageId).toBeNull();
      expect(mockUpdateUser).toHaveBeenCalledWith("u1", {
        photoURL: GOOGLE_PICTURE,
      });
      expect(doc("users/u1")?.photoURL).toBe(GOOGLE_PICTURE);
      expect(actions()).toEqual([
        {
          kind: "removeAvatar",
          target: "u1",
          by: "admin",
          at: expect.any(String),
          reason: "Obraźliwe zdjęcie",
          detail: OWN_PICTURE,
        },
      ]);
      // The record and its line land together, before the picture goes.
      const { log } = store();
      expect(log.indexOf("set profiles/u1")).toBeLessThan(
        log.indexOf("delete images/pic1"),
      );
      expect(log.indexOf("auth u1")).toBeLessThan(
        log.indexOf("delete images/pic1"),
      );
      // The account's row as it is now, for the page to put in place of the
      // one it shows: the users list is a five-minute memo of Auth, and would
      // still have the picture.
      expect(answer).toMatchObject({
        uid: "u1",
        displayName: "Jan Testowy",
        photoURL: GOOGLE_PICTURE,
        avatarRemovable: false,
        profile: { handle: "jan-testowy", public: true, hidden: false },
      });
    });

    // Auth's picture can be pointed anywhere from the browser; taking it down
    // means the provider's again, whether or not we store the picture.
    it("takes down a picture the account points at from elsewhere", async () => {
      store().docs.delete("images/pic1");
      store().seed("profiles/u1", { handle: null, avatarImageId: null });
      accounts.set("u1", {
        photoURL: "https://example.com/tracker.gif",
        providerData: [{ providerId: "google.com", photoURL: GOOGLE_PICTURE }],
      });

      const answer = await moderate(takeDown);

      expect(mockUpdateUser).toHaveBeenCalledWith("u1", {
        photoURL: GOOGLE_PICTURE,
      });
      expect(actions()).toHaveLength(1);
      expect(answer).toMatchObject({
        photoURL: GOOGLE_PICTURE,
        avatarRemovable: false,
      });
    });

    it("has nothing to do for an account showing its provider's picture", async () => {
      store().docs.delete("images/pic1");
      store().seed("profiles/u1", { handle: null, avatarImageId: null });
      accounts.set("u1", {
        photoURL: GOOGLE_PICTURE,
        providerData: [{ providerId: "google.com", photoURL: GOOGLE_PICTURE }],
      });

      await expect(moderate(takeDown)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(store().log).toEqual([]);
    });

    it("sweeps a picture left behind even when the record names none", async () => {
      store().seed("profiles/u1", { handle: null, avatarImageId: null });
      accounts.set("u1", { providerData: [] });

      await moderate(takeDown);

      expect(doc("images/pic1")).toBeUndefined();
    });
  });

  describe("resetName", () => {
    const reset = { uid: "u1", action: "resetName", reason: "Podszywa się" };
    const NEUTRAL = /^uczestnik-[a-z0-9]{4}$/;

    it("clears the name from the account and from the user's document", async () => {
      store().seed("profiles/u1", {
        handle: null,
        avatarImageId: "pic1",
        hidden: null,
      });

      const answer = await moderate(reset);

      expect(mockUpdateUser).toHaveBeenCalledWith("u1", { displayName: null });
      expect(doc("users/u1")).toEqual({
        photoURL: OWN_PICTURE,
        publicProfile: true,
      });
      expect(actions()).toEqual([
        expect.objectContaining({
          kind: "resetName",
          target: "u1",
          by: "admin",
          reason: "Podszywa się",
          detail: "Jan Testowy",
        }),
      ]);
      // Auth first: it cannot join the transaction, and a line saying the name
      // was reset must not exist for a reset that failed.
      const { log } = store();
      expect(log.indexOf("auth u1")).toBeLessThan(log.indexOf("set users/u1"));
      expect(answer).toMatchObject({ uid: "u1", displayName: null });
    });

    it("takes the handle made from the name with it, to a neutral one", async () => {
      store().seed("profileHandles/jan-testowy", {
        uid: "u1",
        createdAt: "2026-10-01T00:00:00.000Z",
      });
      // The owner's own changes of the day, which this is not one of.
      store().seed("profiles/u1", {
        handle: "jan-testowy",
        avatarImageId: "pic1",
        hidden: null,
        handleChanges: { day: "2026-10-05", count: 4 },
      });

      const answer = await moderate(reset);

      const handle = doc("profiles/u1")?.handle as string;
      expect(handle).toMatch(NEUTRAL);
      expect(doc("profiles/u1")?.handleChanges).toEqual({
        day: "2026-10-05",
        count: 4,
      });
      expect(doc(`profileHandles/${handle}`)).toMatchObject({ uid: "u1" });
      // The old address no longer opens anything: it named the person.
      expect(doc("profileHandles/jan-testowy")).toBeUndefined();
      // What it was stays nameable, in the history.
      expect(actions()).toEqual([
        expect.objectContaining({
          kind: "resetName",
          detail: `Jan Testowy (adres profilu: jan-testowy → ${handle})`,
        }),
      ]);
      expect(answer.profile).toEqual({
        handle,
        public: true,
        hidden: false,
      });
      // After Auth, like the rest of the reset.
      const { log } = store();
      expect(log.indexOf("auth u1")).toBeLessThan(
        log.indexOf(`create profileHandles/${handle}`),
      );
    });

    it("does not make up a users document for an account that has none", async () => {
      store().docs.delete("users/u1");

      await moderate(reset);

      expect(doc("users/u1")).toBeUndefined();
      expect(actions()).toHaveLength(1);
    });

    it("has nothing to do for an account with no name", async () => {
      accounts.set("u1", { displayName: undefined });
      store().seed("users/u1", { publicProfile: true });

      await expect(moderate(reset)).rejects.toMatchObject({ statusCode: 409 });
      expect(mockUpdateUser).not.toHaveBeenCalled();
      expect(store().log).toEqual([]);
    });
  });

  describe("hideProfile and unhideProfile", () => {
    it("hides the profile, saying who did and why", async () => {
      const answer = await moderate({
        uid: "u1",
        action: "hideProfile",
        reason: "Wulgarny adres profilu",
      });

      expect(doc("profiles/u1")).toEqual({
        handle: "jan-testowy",
        avatarImageId: "pic1",
        hidden: {
          by: "admin",
          at: expect.any(String),
          reason: "Wulgarny adres profilu",
        },
      });
      expect(actions()).toEqual([
        expect.objectContaining({
          kind: "hideProfile",
          target: "u1",
          by: "admin",
          reason: "Wulgarny adres profilu",
        }),
      ]);
      expect(answer.profile.hidden).toBe(true);
      // Nothing else about the account is touched.
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("hides a profile that does not exist yet, so it never opens", async () => {
      store().docs.delete("profiles/u1");

      await moderate({ uid: "u1", action: "hideProfile", reason: "Spam" });

      expect(doc("profiles/u1")).toEqual({
        handle: null,
        avatarImageId: null,
        hidden: expect.objectContaining({ by: "admin", reason: "Spam" }),
      });
    });

    it("brings a hidden profile back", async () => {
      store().seed("profiles/u1", {
        handle: "jan-testowy",
        avatarImageId: null,
        hidden: { by: "other", at: "2026-10-01T00:00:00Z", reason: "Spam" },
      });

      const answer = await moderate({
        uid: "u1",
        action: "unhideProfile",
        reason: "Wyjaśnione",
      });

      expect(doc("profiles/u1")?.hidden).toBeNull();
      expect(actions()).toEqual([
        expect.objectContaining({
          kind: "unhideProfile",
          reason: "Wyjaśnione",
          detail: "Spam",
        }),
      ]);
      expect(answer.profile.hidden).toBe(false);
    });

    it.each([
      [
        "hiding a hidden profile",
        "hideProfile",
        { by: "other", at: "2026-10-01T00:00:00Z", reason: "Spam" },
      ],
      ["bringing back one that is not hidden", "unhideProfile", null],
    ])("has nothing to do %s", async (_, action, hidden) => {
      store().seed("profiles/u1", {
        handle: "jan-testowy",
        avatarImageId: null,
        hidden,
      });

      await expect(
        moderate({ uid: "u1", action, reason: "Powód" }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(store().log).toEqual([]);
    });
  });
});
