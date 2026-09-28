import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/feedback/create.post";

const { mockSet, mockCommit, mockTxSet, mockVerifyIdToken, daily } = vi.hoisted(
  () => {
    const g = globalThis as Record<string, unknown>;
    g.createError = (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts);
    g.getRequestHeader = (
      event: { headers?: Record<string, string> },
      name: string,
    ) => event.headers?.[name.toLowerCase()];

    return {
      // Every write of a submission goes through one batch.
      mockSet: vi.fn(),
      mockCommit: vi.fn(),
      // The day's counter, as the transaction leaves it.
      mockTxSet: vi.fn(),
      mockVerifyIdToken: vi.fn(),
      // What today's counter already holds, for the daily-cap tests.
      daily: { count: 0, screenshots: 0 },
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

/** A document reference that knows its path, so a test can tell the report
 * from its images. */
const docRef = (path: string) => ({ id: path.split("/").pop(), path });

/** Ids Firestore would make up: the report is always `fb-1`, and images are
 * numbered in the order they are created. */
let imageCount = 0;
const autoId = (collection: string) =>
  collection === "images" ? `img${++imageCount}` : "fb-1";

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id?: string) => docRef(`${name}/${id ?? autoId(name)}`),
    }),
    batch: () => ({ set: mockSet, commit: mockCommit }),
    runTransaction: (
      fn: (tx: {
        get: () => Promise<{ get: (field: string) => number }>;
        set: (ref: unknown, data: unknown) => void;
      }) => Promise<unknown>,
    ) =>
      fn({
        get: async () => ({
          get: (field: string) => daily[field as keyof typeof daily],
        }),
        set: (_ref, data) => mockTxSet(data),
      }),
  }),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

type Event = { body: unknown; headers?: Record<string, string> };

const callHandler = (event: Event) =>
  (
    handler as unknown as (
      e: Event,
    ) => Promise<{ id: string | null; screenshotsDropped?: number }>
  )(event);

const validBody = {
  kind: "bug",
  message: "  Coś tu nie gra  ",
  context: { route: "/osoba/jan-testowy", nodeId: "node-1" },
};

/** What the batch wrote at `path`. */
const writtenAt = (path: string) =>
  mockSet.mock.calls.find(([ref]) => ref.path === path)?.[1];

/** The report itself. */
const written = () => writtenAt("feedback/fb-1");

describe("/api/feedback/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    daily.count = 0;
    daily.screenshots = 0;
    imageCount = 0;
    mockCommit.mockResolvedValue(undefined);
  });

  it("accepts a report from a signed-out visitor", async () => {
    const result = await callHandler({ body: validBody });

    expect(result).toEqual({ id: "fb-1" });
    expect(written()).toMatchObject({
      kind: "bug",
      message: "Coś tu nie gra",
      adminStatus: "new",
    });
    // Anonymous reports carry no uid at all rather than a placeholder.
    expect(written()).not.toHaveProperty("userUid");
  });

  it("attributes the report when a valid token is sent", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "user-a" });

    await callHandler({
      body: validBody,
      headers: { authorization: "Bearer good-token" },
    });

    expect(written()).toMatchObject({ userUid: "user-a" });
  });

  it("falls back to anonymous rather than failing on a bad token", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("expired"));

    await callHandler({
      body: validBody,
      headers: { authorization: "Bearer stale-token" },
    });

    expect(written()).not.toHaveProperty("userUid");
  });

  it("records the user agent from the request, not the body", async () => {
    await callHandler({
      body: validBody,
      headers: { "user-agent": "Mozilla/5.0 (test)" },
    });

    expect(written().context).toMatchObject({
      route: "/osoba/jan-testowy",
      userAgent: "Mozilla/5.0 (test)",
    });
  });

  it("rejects an empty message and an unknown kind", async () => {
    await expect(
      callHandler({ body: { ...validBody, message: "   " } }),
    ).rejects.toThrow();

    await expect(
      callHandler({ body: { ...validBody, kind: "spam" } }),
    ).rejects.toThrow();

    expect(mockCommit).not.toHaveBeenCalled();
  });

  // The admin panel renders the route as a link, so anything that is not a
  // site-relative path is a way to hand an admin a hostile URL.
  it.each([
    "javascript:alert(1)",
    "https://evil.example/login",
    "//evil.example",
    "osoba/bez-ukosnika",
  ])("refuses a route that is not site-relative: %s", async (route) => {
    await expect(
      callHandler({ body: { ...validBody, context: { route } } }),
    ).rejects.toThrow();

    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("keeps the QA entry a verdict was written about", async () => {
    await callHandler({
      body: {
        ...validBody,
        context: {
          route: "/qa",
          qa: {
            itemId: "person-places-map",
            title: "Mapa miejsc osoby w panelu bocznym",
            status: "issue",
          },
        },
      },
    });

    // Same collection, same trigger, same queue as a report from the "Zgłoś"
    // button - it just also knows which entry was being checked.
    expect(written().context.qa).toEqual({
      itemId: "person-places-map",
      title: "Mapa miejsc osoby w panelu bocznym",
      status: "issue",
    });
    expect(written()).toMatchObject({ adminStatus: "new" });
  });

  it("refuses a QA context that is not a verdict on an entry", async () => {
    for (const qa of [
      { itemId: "a", title: "T", status: "maybe" },
      { itemId: "", title: "T", status: "ok" },
      { itemId: "a", status: "ok" },
    ]) {
      await expect(
        callHandler({
          body: { ...validBody, context: { route: "/qa", qa } },
        }),
      ).rejects.toThrow();
    }

    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("drops a submission that filled the honeypot, without saying so", async () => {
    const result = await callHandler({
      body: { ...validBody, website: "http://spam.example" },
    });

    expect(result).toEqual({ id: null });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("still saves past the daily cap, but marks it not to reach Slack", async () => {
    daily.count = 500;

    await callHandler({ body: validBody });

    // The report is kept - /admin/opinie stays authoritative - and only the
    // forward is suppressed, so one abuser cannot silence real reporters.
    expect(mockCommit).toHaveBeenCalled();
    expect(written().slack).toEqual({ state: "failed", error: "daily_cap" });
  });

  it("leaves the Slack state alone under the cap", async () => {
    daily.count = 3;

    await callHandler({ body: validBody });

    expect(written()).not.toHaveProperty("slack");
  });
  describe("with screenshots", () => {
    /** The header of a PNG, which is all the server reads of one. */
    const png = (width: number, height: number, padTo = 0) => {
      const header = [
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        0,
        0,
        0,
        13,
        ...Buffer.from("IHDR"),
        width >>> 24,
        (width >>> 16) & 255,
        (width >>> 8) & 255,
        width & 255,
        height >>> 24,
        (height >>> 16) & 255,
        (height >>> 8) & 255,
        height & 255,
        8,
        6,
        0,
        0,
        0,
      ];
      return Buffer.concat([
        Buffer.from(header),
        Buffer.alloc(Math.max(0, padTo - header.length)),
      ]);
    };
    const dataUrl = (bytes: Buffer, type = "image/png") =>
      `data:${type};base64,${bytes.toString("base64")}`;

    it("keeps each one as a document under the report, in the same batch", async () => {
      const first = png(1920, 1080);
      const second = png(390, 844);

      const result = await callHandler({
        body: {
          ...validBody,
          screenshots: [dataUrl(first), dataUrl(second)],
        },
      });

      expect(result).toEqual({ id: "fb-1" });
      expect(written().screenshots).toEqual([
        {
          imageId: "img1",
          contentType: "image/png",
          width: 1920,
          height: 1080,
          bytes: first.length,
        },
        {
          imageId: "img2",
          contentType: "image/png",
          width: 390,
          height: 844,
          bytes: second.length,
        },
      ]);
      // The bytes are never in the report, which the admin list reads whole.
      expect(JSON.stringify(written())).not.toContain(first.toString("base64"));

      // Kept in `images` with every other upload, as the report's and for
      // admins' eyes only.
      const image = writtenAt("images/img1");
      expect(image).toMatchObject({
        contentType: "image/png",
        width: 1920,
        height: 1080,
        bytes: first.length,
        purpose: "feedback",
        subject: "feedback/fb-1",
      });
      // Nobody signed this report, so nothing says who sent the image either.
      expect(image).not.toHaveProperty("uploadedBy");
      expect(Buffer.compare(image.data, first)).toBe(0);
      expect(Buffer.compare(writtenAt("images/img2").data, second)).toBe(0);

      // One commit: the report never exists without its images.
      expect(mockCommit).toHaveBeenCalledTimes(1);
      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1, screenshots: 2 }),
      );
    });

    // The panel serves an image back as the type it was stored as, so a type
    // the client chose could turn an upload into a page.
    it.each([
      [
        "an SVG",
        dataUrl(
          Buffer.from("<svg><script>alert(1)</script></svg>"),
          "image/svg+xml",
        ),
      ],
      [
        "HTML called a PNG",
        dataUrl(Buffer.from("<html><body>hi</body></html>")),
      ],
      ["a PNG called a WebP", dataUrl(png(10, 10), "image/webp")],
      ["something that is not a data url", "https://example.com/a.png"],
      ["a canvas larger than the dialog sends", dataUrl(png(9000, 9000))],
    ])("refuses the whole report for %s", async (_, screenshot) => {
      await expect(
        callHandler({ body: { ...validBody, screenshots: [screenshot] } }),
      ).rejects.toThrow();

      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("refuses an image over the size limit", async () => {
      const heavy = png(100, 100, 1_000_001);

      await expect(
        callHandler({ body: { ...validBody, screenshots: [dataUrl(heavy)] } }),
      ).rejects.toThrow();
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("refuses more than three", async () => {
      const four = Array.from({ length: 4 }, () => dataUrl(png(10, 10)));

      await expect(
        callHandler({ body: { ...validBody, screenshots: four } }),
      ).rejects.toThrow();
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("saves the report without them once the day's allowance is spent", async () => {
      daily.screenshots = 99;

      const result = await callHandler({
        body: {
          ...validBody,
          screenshots: [dataUrl(png(10, 10)), dataUrl(png(20, 20))],
        },
      });

      // The reporter is told, and so is the admin reading the report.
      expect(result).toEqual({ id: "fb-1", screenshotsDropped: 2 });
      expect(written()).not.toHaveProperty("screenshots");
      expect(written().screenshotsDropped).toBe(2);
      expect(mockSet).toHaveBeenCalledTimes(1);
      // Images not kept are not counted against the allowance.
      expect(mockTxSet).toHaveBeenCalledWith(
        expect.not.objectContaining({ screenshots: expect.anything() }),
      );
    });

    it("drops them with a submission that filled the honeypot", async () => {
      const result = await callHandler({
        body: {
          ...validBody,
          website: "http://spam.example",
          screenshots: [dataUrl(png(10, 10))],
        },
      });

      expect(result).toEqual({ id: null });
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("records who sent the images of a signed report", async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: "user-a" });

      await callHandler({
        body: { ...validBody, screenshots: [dataUrl(png(10, 10))] },
        headers: { authorization: "Bearer good-token" },
      });

      expect(writtenAt("images/img1")).toMatchObject({
        uploadedBy: "user-a",
      });
    });

    it("writes nothing extra for a report without any", async () => {
      await callHandler({ body: validBody });

      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(written()).not.toHaveProperty("screenshots");
      expect(written()).not.toHaveProperty("screenshotsDropped");
    });
  });
});
