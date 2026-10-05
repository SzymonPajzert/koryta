import { describe, it, expect, vi, beforeEach } from "vitest";
import setAvatar from "../../../server/api/users/avatar.post";
import removeAvatar from "../../../server/api/users/avatar.delete";
import { ownAvatarPath } from "../../../server/utils/avatars";
import type { MemoryFirestore } from "./memoryFirestore";

const { mockVerifyIdToken, mockUpdateUser, mockGetUser, memory } = vi.hoisted(
  () => {
    const g = globalThis as Record<string, unknown>;
    g.createError = (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts);
    g.getRequestHeader = (
      event: { headers?: Record<string, string> },
      name: string,
    ) => event.headers?.[name.toLowerCase()];

    return {
      mockVerifyIdToken: vi.fn(),
      mockUpdateUser: vi.fn(),
      mockGetUser: vi.fn(),
      memory: {} as { store: MemoryFirestore },
    };
  },
);

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
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

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
    updateUser: mockUpdateUser,
    getUser: mockGetUser,
  }),
}));

type Event = { body?: unknown; headers?: Record<string, string> };
const call = (fn: unknown, event: Event) =>
  (fn as (e: Event) => Promise<Record<string, unknown>>)(event);
const signedIn = { authorization: "Bearer good-token" };

/** The header of a PNG, which is all the server reads of one. */
const png = (width: number, height: number) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
};

const store = () => memory.store;
const doc = (path: string) => store().docs.get(path);
const avatarOf = (uid: string, id: string) =>
  store().seed(`images/${id}`, {
    purpose: "avatar",
    subject: `users/${uid}`,
    data: new Uint8Array(),
  });
/** The url Auth was last pointed at for `uid`. */
const lastAuthPhoto = (uid: string) =>
  mockUpdateUser.mock.calls.filter(([at]) => at === uid).at(-1)?.[1]
    ?.photoURL as string | null | undefined;
const imageIdOf = (url: string | null | undefined) =>
  url ? new URL(url).pathname.split("/").pop() : url;

/** Another request committing its own upload for `uid`, the way the POST
 * transaction does: the image and the record together. */
const otherUploadLands = (uid: string, id: string) => {
  avatarOf(uid, id);
  store().seed(`profiles/${uid}`, {
    ...doc(`profiles/${uid}`),
    avatarImageId: id,
  });
};

describe("/api/users/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store().reset();
    mockVerifyIdToken.mockResolvedValue({ uid: "u1", email_verified: true });
    // Into the same log as the database writes, so the order of the two can
    // be read off one list.
    mockUpdateUser.mockImplementation(async (uid: string) => {
      store().log.push(`auth ${uid}`);
      return {};
    });
    mockGetUser.mockResolvedValue({ providerData: [] });
  });

  describe("POST", () => {
    it("stores the picture, records it as the user's own and shows it wherever the user's picture is", async () => {
      const answer = await call(setAvatar, {
        body: { image: png(512, 512) },
        headers: signedIn,
      });

      expect(doc("images/img1")).toMatchObject({
        contentType: "image/png",
        width: 512,
        height: 512,
        purpose: "avatar",
        subject: "users/u1",
        uploadedBy: "u1",
      });
      // The one record a public surface may read: Auth and the users
      // document can both be pointed anywhere from the browser.
      expect(doc("profiles/u1")).toEqual({
        handle: null,
        avatarImageId: "img1",
        hidden: null,
      });
      // Absolute, because Auth takes nothing else, and on the site itself.
      const url = lastAuthPhoto("u1");
      expect(url).toMatch(/^https?:\/\/[^/]+\/api\/images\/img1$/);
      // And the user's own layout reads it from their document.
      expect(doc("users/u1")).toEqual({ photoURL: url });
      expect(answer.photoURL).toBe(url);
    });

    it("keeps what else the profile holds", async () => {
      store().seed("profiles/u1", {
        handle: "jan",
        avatarImageId: null,
        hidden: null,
      });

      await call(setAvatar, {
        body: { image: png(512, 512) },
        headers: signedIn,
      });

      expect(doc("profiles/u1")).toEqual({
        handle: "jan",
        avatarImageId: "img1",
        hidden: null,
      });
    });

    // Any address can be registered by anybody, and the picture is public
    // the moment it is stored.
    it("refuses an account whose address is not confirmed", async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: "u1", email_verified: false });

      await expect(
        call(setAvatar, { body: { image: png(512, 512) }, headers: signedIn }),
      ).rejects.toMatchObject({
        statusCode: 403,
        message: "Potwierdź adres e-mail, zanim dodasz zdjęcie profilowe.",
      });

      expect(store().log).toEqual([]);
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("deletes the picture it replaces, once nothing points at it", async () => {
      avatarOf("u1", "old1");
      store().seed("profiles/u1", {
        handle: null,
        avatarImageId: "old1",
        hidden: null,
      });

      await call(setAvatar, {
        body: { image: png(256, 256) },
        headers: signedIn,
      });

      expect(doc("images/old1")).toBeUndefined();
      expect(doc("profiles/u1")?.avatarImageId).toBe("img1");
      const { log } = store();
      expect(log.indexOf("auth u1")).toBeLessThan(
        log.indexOf("delete images/old1"),
      );
      expect(log.indexOf("set users/u1")).toBeLessThan(
        log.indexOf("delete images/old1"),
      );
    });

    // What the upload before this change, which had no record, left behind
    // when two requests crossed - and what a request that failed half way
    // still leaves.
    it("deletes the user's other pictures the record does not name, and nobody else's", async () => {
      avatarOf("u1", "stray1");
      avatarOf("u2", "theirs");
      store().seed("images/shot", {
        purpose: "feedback",
        subject: "feedback/f1",
      });

      await call(setAvatar, {
        body: { image: png(256, 256) },
        headers: signedIn,
      });

      expect(doc("images/stray1")).toBeUndefined();
      expect(doc("images/theirs")).toBeDefined();
      expect(doc("images/shot")).toBeDefined();
      expect(doc("images/img1")).toBeDefined();
    });

    it("points the account at the picture that won when another upload landed in between", async () => {
      // The other request commits after this one's transaction and before
      // this one points Auth anywhere.
      mockUpdateUser.mockImplementationOnce(async () => {
        otherUploadLands("u1", "imgB");
        return {};
      });

      const answer = await call(setAvatar, {
        body: { image: png(256, 256) },
        headers: signedIn,
      });

      expect(imageIdOf(lastAuthPhoto("u1"))).toBe("imgB");
      expect(imageIdOf(doc("users/u1")?.photoURL as string)).toBe("imgB");
      expect(imageIdOf(answer.photoURL as string)).toBe("imgB");
      // Its own picture lost, so it is the one that goes.
      expect(doc("images/img1")).toBeUndefined();
      expect(doc("images/imgB")).toBeDefined();
      expect(doc("profiles/u1")?.avatarImageId).toBe("imgB");
    });

    it("leaves alone an upload that lands while it cleans up", async () => {
      // The listing has been read; the other request commits before the
      // record is read back.
      store().hooks.afterQuery = () => otherUploadLands("u1", "imgB");

      await call(setAvatar, {
        body: { image: png(256, 256) },
        headers: signedIn,
      });

      expect(doc("images/imgB")).toBeDefined();
      expect(doc("profiles/u1")?.avatarImageId).toBe("imgB");
      // Nor does it delete its own, which the account still shows until the
      // other request points it at the winner - and sweeps this one then.
      expect(imageIdOf(lastAuthPhoto("u1"))).toBe("img1");
      expect(doc("images/img1")).toBeDefined();
    });

    it.each([
      ["a picture that is not square", png(512, 400)],
      ["a picture larger than 512 px", png(1024, 1024)],
      ["something that is not an image", "data:image/png;base64,PGh0bWw+"],
    ])("refuses %s", async (_, image) => {
      await expect(
        call(setAvatar, { body: { image }, headers: signedIn }),
      ).rejects.toThrow();

      expect(store().log).toEqual([]);
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("needs a signed-in user", async () => {
      await expect(
        call(setAvatar, { body: { image: png(512, 512) } }),
      ).rejects.toMatchObject({ statusCode: 401 });

      expect(store().log).toEqual([]);
    });
  });

  describe("DELETE", () => {
    beforeEach(() => {
      avatarOf("u1", "old1");
      store().seed("profiles/u1", {
        handle: "jan",
        avatarImageId: "old1",
        hidden: null,
      });
    });

    it("goes back to the picture of the account the user signs in with", async () => {
      mockGetUser.mockResolvedValue({
        providerData: [
          { providerId: "password" },
          { providerId: "google.com", photoURL: "https://lh3.example/a.jpg" },
        ],
      });

      const answer = await call(removeAvatar, { headers: signedIn });

      expect(mockUpdateUser).toHaveBeenCalledWith("u1", {
        photoURL: "https://lh3.example/a.jpg",
      });
      expect(answer.photoURL).toBe("https://lh3.example/a.jpg");
      expect(doc("images/old1")).toBeUndefined();
      expect(doc("profiles/u1")).toEqual({
        handle: "jan",
        avatarImageId: null,
        hidden: null,
      });
    });

    // Auth copies the account's picture into the password provider, so that
    // copy is the very avatar being taken down.
    it("does not go back to the copy of the avatar Auth keeps for a password", async () => {
      mockGetUser.mockResolvedValue({
        providerData: [
          {
            providerId: "password",
            photoURL: "https://koryta.pl/api/images/old1",
          },
        ],
      });

      const answer = await call(removeAvatar, { headers: signedIn });

      expect(mockUpdateUser).toHaveBeenCalledWith("u1", { photoURL: null });
      expect(answer.photoURL).toBeNull();
    });

    it("leaves no picture when the account never had one, and deletes only after nothing points at it", async () => {
      const answer = await call(removeAvatar, { headers: signedIn });

      expect(mockUpdateUser).toHaveBeenCalledWith("u1", { photoURL: null });
      expect(doc("users/u1")).toEqual({});
      expect(answer.photoURL).toBeNull();
      const { log } = store();
      expect(log.indexOf("auth u1")).toBeLessThan(
        log.indexOf("delete images/old1"),
      );
      expect(log.indexOf("set users/u1")).toBeLessThan(
        log.indexOf("delete images/old1"),
      );
    });

    it("gives way to an upload that landed in between", async () => {
      mockUpdateUser.mockImplementationOnce(async () => {
        otherUploadLands("u1", "imgB");
        return {};
      });

      await call(removeAvatar, { headers: signedIn });

      expect(imageIdOf(lastAuthPhoto("u1"))).toBe("imgB");
      expect(doc("images/imgB")).toBeDefined();
      expect(doc("images/old1")).toBeUndefined();
    });

    // Taking a picture down is always allowed; only putting one up needs a
    // confirmed address.
    it("lets an account whose address is not confirmed remove its picture", async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: "u1", email_verified: false });

      await call(removeAvatar, { headers: signedIn });

      expect(doc("images/old1")).toBeUndefined();
      expect(doc("profiles/u1")?.avatarImageId).toBeNull();
    });

    it("does not make up a profile for an account that has none", async () => {
      store().docs.delete("profiles/u1");

      await call(removeAvatar, { headers: signedIn });

      expect(doc("profiles/u1")).toBeUndefined();
      // The picture is swept all the same.
      expect(doc("images/old1")).toBeUndefined();
    });

    it("needs a signed-in user", async () => {
      await expect(call(removeAvatar, {})).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(store().log).toEqual([]);
    });
  });
});

describe("ownAvatarPath", () => {
  it("is the site's path to the picture the record names", () => {
    expect(
      ownAvatarPath({ handle: "jan", avatarImageId: "abc123", hidden: null }),
    ).toBe("/api/images/abc123");
  });

  it.each([
    ["no profile", undefined],
    ["no picture", { handle: "jan", avatarImageId: null, hidden: null }],
    ["a profile written before pictures were", { handle: "jan" }],
    ["an id that is not one", { avatarImageId: "../users/u1" }],
  ])("is nothing for %s", (_, profile) => {
    expect(ownAvatarPath(profile as never)).toBeNull();
  });
});
