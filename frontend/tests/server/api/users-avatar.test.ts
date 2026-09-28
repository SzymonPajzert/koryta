import { describe, it, expect, vi, beforeEach } from "vitest";
import setAvatar from "../../../server/api/users/avatar.post";
import removeAvatar from "../../../server/api/users/avatar.delete";

const {
  mockVerifyIdToken,
  mockUpdateUser,
  mockGetUser,
  mockSet,
  mockDelete,
  existing,
  DELETE_FIELD,
} = vi.hoisted(() => {
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
    /** Every document written, as (path, data, options). */
    mockSet: vi.fn(),
    /** Every document deleted, by path. */
    mockDelete: vi.fn(),
    /** What `images` already holds, as the query sees it. */
    existing: [] as { id: string; subject: string; purpose: string }[],
    DELETE_FIELD: { deleteField: true },
  };
});

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

let imageCount = 0;
const ref = (path: string) => ({
  id: path.split("/").pop(),
  path,
  set: async (data: unknown, options?: unknown) => mockSet(path, data, options),
});

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { delete: () => DELETE_FIELD },
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id?: string) => ref(`${name}/${id ?? `img${++imageCount}`}`),
      where: (field: string, op: string, value: unknown) => ({
        select: () => ({
          get: async () => {
            if (name !== "images" || field !== "subject" || op !== "==") {
              throw new Error(`unexpected query ${name}.${field} ${op}`);
            }
            return {
              docs: existing
                .filter((image) => image.subject === value)
                .map((image) => ({
                  id: image.id,
                  get: (key: "purpose") => image[key],
                })),
            };
          },
        }),
      }),
    }),
    batch: () => {
      const deletes: string[] = [];
      return {
        delete: (target: { path: string }) => deletes.push(target.path),
        commit: async () => deletes.forEach((path) => mockDelete(path)),
      };
    },
  }),
}));

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

const written = (path: string) =>
  mockSet.mock.calls.find(([at]) => at === path)?.[1];

describe("/api/users/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageCount = 0;
    existing.length = 0;
    mockVerifyIdToken.mockResolvedValue({ uid: "u1" });
    mockUpdateUser.mockResolvedValue({});
  });

  describe("POST", () => {
    it("stores the picture and shows it wherever the user's picture is", async () => {
      const answer = await call(setAvatar, {
        body: { image: png(512, 512) },
        headers: signedIn,
      });

      expect(written("images/img1")).toMatchObject({
        contentType: "image/png",
        width: 512,
        height: 512,
        purpose: "avatar",
        subject: "users/u1",
        uploadedBy: "u1",
      });
      // Absolute, because Auth takes nothing else, and on the site itself;
      // everybody else's view of the user reads it from there.
      const [uid, { photoURL: url }] = mockUpdateUser.mock.calls[0]!;
      expect(uid).toBe("u1");
      expect(url).toMatch(/^https?:\/\/[^/]+\/api\/images\/img1$/);
      // And the user's own layout reads it from their document.
      expect(mockSet).toHaveBeenCalledWith(
        "users/u1",
        { photoURL: url },
        { merge: true },
      );
      expect(answer.photoURL).toBe(url);
    });

    it("deletes the picture it replaces, once nothing points at it", async () => {
      existing.push(
        { id: "old1", subject: "users/u1", purpose: "avatar" },
        { id: "other", subject: "users/u2", purpose: "avatar" },
      );

      await call(setAvatar, {
        body: { image: png(256, 256) },
        headers: signedIn,
      });

      expect(mockDelete.mock.calls).toEqual([["images/old1"]]);
      expect(mockUpdateUser.mock.invocationCallOrder[0]).toBeLessThan(
        mockDelete.mock.invocationCallOrder[0]!,
      );
    });

    it.each([
      ["a picture that is not square", png(512, 400)],
      ["a picture larger than 512 px", png(1024, 1024)],
      ["something that is not an image", "data:image/png;base64,PGh0bWw+"],
    ])("refuses %s", async (_, image) => {
      await expect(
        call(setAvatar, { body: { image }, headers: signedIn }),
      ).rejects.toThrow();

      expect(mockSet).not.toHaveBeenCalled();
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("needs a signed-in user", async () => {
      await expect(
        call(setAvatar, { body: { image: png(512, 512) } }),
      ).rejects.toMatchObject({ statusCode: 401 });

      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    beforeEach(() => {
      existing.push({ id: "old1", subject: "users/u1", purpose: "avatar" });
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
      expect(mockDelete.mock.calls).toEqual([["images/old1"]]);
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

    it("leaves no picture when the account never had one", async () => {
      mockGetUser.mockResolvedValue({ providerData: [] });

      await call(removeAvatar, { headers: signedIn });

      expect(mockUpdateUser).toHaveBeenCalledWith("u1", { photoURL: null });
      expect(mockSet).toHaveBeenCalledWith(
        "users/u1",
        { photoURL: DELETE_FIELD },
        { merge: true },
      );
      expect(mockUpdateUser.mock.invocationCallOrder[0]).toBeLessThan(
        mockDelete.mock.invocationCallOrder[0]!,
      );
    });

    it("needs a signed-in user", async () => {
      await expect(call(removeAvatar, {})).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});
