import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/images/[id].get";

const { mockVerifyIdToken, stored, reads } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.getRequestHeader = (
    event: { headers?: Record<string, string> },
    name: string,
  ) => event.headers?.[name.toLowerCase()];

  return {
    mockVerifyIdToken: vi.fn(),
    /** Documents by path: `images/<id>`, `nodes/<id>`. */
    stored: new Map<string, Record<string, unknown>>(),
    /** Every path read, so a test can say what was not. */
    reads: [] as string[],
  };
});

type Event = {
  params: { id?: string };
  headers?: Record<string, string>;
  sent: Record<string, string>;
};

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getRouterParam: (event: Event, name: "id") => event.params[name],
    setResponseHeader: (event: Event, name: string, value: string) => {
      event.sent[name] = value;
    },
    setResponseHeaders: (event: Event, headers: Record<string, string>) =>
      Object.assign(event.sent, headers),
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          reads.push(`${name}/${id}`);
          const data = stored.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  }),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const IMAGE = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3]);

const image = (purpose: string, subject: string) => ({
  data: IMAGE,
  contentType: "image/webp",
  width: 10,
  height: 10,
  bytes: IMAGE.length,
  purpose,
  subject,
  createdAt: "2026-09-28T10:00:00.000Z",
});

const person = (fields: Record<string, unknown>) => ({
  type: "person",
  name: "Jan Testowy",
  published: true,
  ...fields,
});

/** The image handed back, or the status it was refused with. */
async function fetchImage(id: string, token?: string) {
  const event: Event = {
    params: { id },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    sent: {},
  };
  try {
    const body = await (handler as unknown as (e: Event) => Promise<Buffer>)(
      event,
    );
    return { status: 200, body, headers: event.sent };
  } catch (error) {
    return {
      status: (error as { statusCode?: number }).statusCode ?? 500,
      body: undefined,
      headers: event.sent,
    };
  }
}

describe("/api/images/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored.clear();
    reads.length = 0;
    mockVerifyIdToken.mockImplementation(async (token: string) =>
      token === "admin-token"
        ? { uid: "admin", admin: true }
        : { uid: "reader" },
    );
  });

  describe("a report's screenshot", () => {
    beforeEach(() => {
      stored.set("images/shot1", image("feedback", "feedback/fb1"));
    });

    it("is served to an admin, and kept out of shared caches", async () => {
      const answer = await fetchImage("shot1", "admin-token");

      expect(answer.status).toBe(200);
      expect(Buffer.compare(answer.body!, IMAGE)).toBe(0);
      expect(answer.headers).toMatchObject({
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
      });
      expect(answer.headers["Cache-Control"]).toMatch(/^private/);
    });

    // Not even whether the report has one gets out: the same answer as for
    // an image that does not exist.
    it.each([
      ["nobody signed in", undefined],
      ["a signed-in reader who is not an admin", "reader-token"],
    ])("is not found for %s", async (_, token) => {
      const answer = await fetchImage("shot1", token);

      expect(answer.status).toBe(404);
      expect(answer.headers["Cache-Control"]).toBe("no-store");
    });
  });

  describe("a profile picture", () => {
    it("is served to anybody, from any cache", async () => {
      stored.set("images/avatar1", image("avatar", "users/u1"));

      const answer = await fetchImage("avatar1");

      expect(answer.status).toBe(200);
      expect(answer.headers["Cache-Control"]).toMatch(/^public, max-age=\d+/);
      // Public, so nobody's token is checked for it.
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });

  describe("a photo of a person", () => {
    beforeEach(() => {
      stored.set("images/photo1", image("person", "nodes/p1"));
    });

    it("is public while it is the photo of a published page", async () => {
      stored.set("nodes/p1", person({ photo: { imageId: "photo1" } }));

      const answer = await fetchImage("photo1");

      expect(answer.status).toBe(200);
      expect(answer.headers["Cache-Control"]).toMatch(/^public/);
    });

    // Uploaded and proposed, but nobody has approved it yet: the page does
    // not show it, so only a reviewer can see it.
    it("is shown only to admins until a proposal naming it is approved", async () => {
      stored.set("nodes/p1", person({}));

      expect((await fetchImage("photo1")).status).toBe(404);
      expect((await fetchImage("photo1", "reader-token")).status).toBe(404);
      const admin = await fetchImage("photo1", "admin-token");
      expect(admin.status).toBe(200);
      expect(admin.headers["Cache-Control"]).toMatch(/^private/);
    });

    it("stops being public once another photo replaces it", async () => {
      stored.set("nodes/p1", person({ photo: { imageId: "photo2" } }));

      expect((await fetchImage("photo1")).status).toBe(404);
    });

    it.each([
      ["is not published", { published: false }],
      ["was taken down", { deleted: true }],
    ])("is not public while the page %s", async (_, fields) => {
      stored.set(
        "nodes/p1",
        person({ photo: { imageId: "photo1" }, ...fields }),
      );

      expect((await fetchImage("photo1")).status).toBe(404);
      expect((await fetchImage("photo1", "admin-token")).status).toBe(200);
    });

    it("is public only through the page it was uploaded for", async () => {
      stored.set("images/photo1", image("person", "users/p1"));
      stored.set("users/p1", person({ photo: { imageId: "photo1" } }));

      expect((await fetchImage("photo1")).status).toBe(404);
    });
  });

  it("does not look up an id that could not be an image's", async () => {
    for (const id of ["", "..", "a/b", "x".repeat(65)]) {
      expect((await fetchImage(id, "admin-token")).status).toBe(404);
    }
    expect(reads).toEqual([]);
  });

  it("serves nothing under a type it does not serve images as", async () => {
    stored.set("images/odd", {
      ...image("avatar", "users/u1"),
      contentType: "text/html",
    });

    expect((await fetchImage("odd", "admin-token")).status).toBe(404);
  });

  it("answers 404 for an image that is not there", async () => {
    const answer = await fetchImage("missing", "admin-token");

    expect(answer.status).toBe(404);
    expect(answer.headers["Cache-Control"]).toBe("no-store");
  });
});
