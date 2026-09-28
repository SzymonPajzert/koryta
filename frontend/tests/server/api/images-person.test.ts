import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/images/person.post";

const { mockVerifyIdToken, mockSet, nodes, counters } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.getRequestHeader = (
    event: { headers?: Record<string, string> },
    name: string,
  ) => event.headers?.[name.toLowerCase()];

  return {
    mockVerifyIdToken: vi.fn(),
    /** Every document written, as (path, data). */
    mockSet: vi.fn(),
    nodes: new Map<string, Record<string, unknown>>(),
    /** `imageLimits` documents by id. */
    counters: new Map<string, Record<string, unknown>>(),
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
const ref = (collection: string, id: string) => ({
  id,
  path: `${collection}/${id}`,
  collection,
  get: async () => {
    const data = collection === "nodes" ? nodes.get(id) : counters.get(id);
    return { exists: !!data, data: () => data, get: (k: string) => data?.[k] };
  },
  set: async (data: unknown) => mockSet(`${collection}/${id}`, data),
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id?: string) => ref(name, id ?? `img${++imageCount}`),
    }),
    runTransaction: async (
      fn: (tx: {
        get: (
          r: ReturnType<typeof ref>,
        ) => ReturnType<ReturnType<typeof ref>["get"]>;
        set: (r: ReturnType<typeof ref>, data: Record<string, unknown>) => void;
      }) => Promise<unknown>,
    ) =>
      fn({
        get: (r) => r.get(),
        set: (r, data) => {
          counters.set(r.id, { ...counters.get(r.id), ...data });
        },
      }),
  }),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

type Event = { body?: unknown; headers?: Record<string, string> };
const upload = (body: unknown, token = "user-token") =>
  (handler as unknown as (e: Event) => Promise<Record<string, unknown>>)({
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

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

describe("/api/images/person", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageCount = 0;
    nodes.clear();
    counters.clear();
    nodes.set("p1", { type: "person", name: "Jan Testowy", published: true });
    mockVerifyIdToken.mockImplementation(async (token: string) =>
      token === "admin-token" ? { uid: "admin", admin: true } : { uid: "u1" },
    );
  });

  it("keeps the photo for the person, and says what to propose it by", async () => {
    const answer = await upload({ nodeId: "p1", image: png(900, 1200) });

    expect(mockSet).toHaveBeenCalledWith(
      "images/img1",
      expect.objectContaining({
        contentType: "image/png",
        width: 900,
        height: 1200,
        purpose: "person",
        subject: "nodes/p1",
        uploadedBy: "u1",
      }),
    );
    expect(answer.image).toEqual({
      imageId: "img1",
      contentType: "image/png",
      width: 900,
      height: 1200,
      bytes: 33,
    });
  });

  it.each([
    ["nobody", undefined],
    ["a company", { type: "place", name: "Orlen" }],
    ["a person whose page was taken down", { type: "person", deleted: true }],
  ])("has nowhere to put a photo of %s", async (_, node) => {
    if (node) nodes.set("p2", node);

    await expect(
      upload({ nodeId: "p2", image: png(900, 1200) }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it.each([
    ["larger than a portrait needs", png(1200, 1601)],
    ["not an image", "data:image/png;base64,PGh0bWw+"],
  ])("refuses a photo %s", async (_, image) => {
    await expect(upload({ nodeId: "p1", image })).rejects.toThrow();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("takes twenty a day from one contributor, and any number from an admin", async () => {
    for (let i = 0; i < 20; i++) {
      await upload({ nodeId: "p1", image: png(900, 1200) });
    }
    await expect(
      upload({ nodeId: "p1", image: png(900, 1200) }),
    ).rejects.toMatchObject({ statusCode: 429 });

    await expect(
      upload({ nodeId: "p1", image: png(900, 1200) }, "admin-token"),
    ).resolves.toBeDefined();
    expect(mockSet).toHaveBeenCalledTimes(21);
  });

  it("needs a signed-in user", async () => {
    await expect(
      upload({ nodeId: "p1", image: png(900, 1200) }, ""),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockSet).not.toHaveBeenCalled();
  });
});
