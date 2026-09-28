import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/feedback/screenshot.get";

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
    /** Image documents by path. */
    stored: new Map<string, Record<string, unknown>>(),
    /** Every path read, so a test can say nothing was. */
    reads: [] as string[],
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
    setResponseHeaders: (
      event: { sent: Record<string, string> },
      headers: Record<string, string>,
    ) => Object.assign(event.sent, headers),
  };
});

const docRef = (path: string) => ({
  collection: (name: string) => ({
    doc: (id: string) => docRef(`${path}/${name}/${id}`),
  }),
  get: async () => {
    reads.push(path);
    const data = stored.get(path);
    return {
      exists: data !== undefined,
      get: (field: string) => data?.[field],
    };
  },
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`),
    }),
  }),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

type Event = {
  query: Record<string, string>;
  headers?: Record<string, string>;
  sent: Record<string, string>;
};

const callHandler = (query: Record<string, string>, token?: string) => {
  const event: Event = {
    query,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    sent: {},
  };
  return {
    event,
    result: (handler as unknown as (e: Event) => Promise<unknown>)(event),
  };
};

const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("/api/feedback/screenshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored.clear();
    reads.length = 0;
    stored.set("feedback/fb-1/screenshots/0", {
      data: IMAGE,
      contentType: "image/png",
    });
    mockVerifyIdToken.mockImplementation(async (token: string) =>
      token === "admin-token"
        ? { uid: "admin", admin: true }
        : { uid: "someone" },
    );
  });

  it("serves an admin the image, as the type it was stored as", async () => {
    const { event, result } = callHandler(
      { id: "fb-1", n: "0" },
      "admin-token",
    );

    expect(Buffer.compare((await result) as Buffer, IMAGE)).toBe(0);
    expect(event.sent).toMatchObject({
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    });
    // Never in a shared cache: it came through an admin's token.
    expect(event.sent["Cache-Control"]).toMatch(/^private/);
  });

  // A screenshot is as private as the report it came with.
  it.each([
    ["nobody signed in", undefined, 401],
    ["a signed-in reader who is not an admin", "reader-token", 403],
  ])("refuses %s, before reading anything", async (_, token, statusCode) => {
    await expect(
      callHandler({ id: "fb-1", n: "0" }, token).result,
    ).rejects.toMatchObject({ statusCode });
    expect(reads).toEqual([]);
  });

  it("answers 404 for an image the report does not have", async () => {
    await expect(
      callHandler({ id: "fb-1", n: "1" }, "admin-token").result,
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // Only ever written by the create route, which sniffs the bytes - but the
  // type is what the browser acts on, so it is checked on the way out too.
  it("will not serve a document under any other type", async () => {
    stored.set("feedback/fb-1/screenshots/0", {
      data: Buffer.from("<html></html>"),
      contentType: "text/html",
    });

    await expect(
      callHandler({ id: "fb-1", n: "0" }, "admin-token").result,
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each([
    [{ id: "fb-1", n: "3" }],
    [{ id: "fb-1", n: "-1" }],
    [{ id: "fb-1/screenshots/0", n: "0" }],
    [{ id: "", n: "0" }],
  ])("refuses a query outside a report's images: %o", async (query) => {
    await expect(callHandler(query, "admin-token").result).rejects.toThrow();
    expect(reads).toEqual([]);
  });
});
