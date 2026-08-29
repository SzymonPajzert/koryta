import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/feedback/qa.get";
import type { Feedback } from "../../../shared/model";

const { mockGet, mockWhere, mockOrderBy, mockLimit, mockVerifyIdToken } =
  vi.hoisted(() => {
    const g = globalThis as Record<string, unknown>;
    g.createError = (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts);
    g.getRequestHeader = (
      event: { headers?: Record<string, string> },
      name: string,
    ) => event.headers?.[name.toLowerCase()];

    return {
      mockGet: vi.fn(),
      mockWhere: vi.fn(),
      mockOrderBy: vi.fn(),
      mockLimit: vi.fn(),
      mockVerifyIdToken: vi.fn(),
    };
  });

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return { ...actual, defineEventHandler: (fn: unknown) => fn };
});

// `getUser` is left real, so the 401 below is the one the route would give.
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock("firebase-admin/firestore", () => {
  const query = {
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
    get: mockGet,
  };
  mockWhere.mockReturnValue(query);
  mockOrderBy.mockReturnValue(query);
  mockLimit.mockReturnValue(query);

  return { getFirestore: () => ({ collection: () => query }) };
});

type Event = { headers?: Record<string, string> };
type Result = {
  resolutions: Record<
    string,
    { itemId: string; status: string; reportedAt: string }
  >;
};

const callHandler = (event: Event = {}) =>
  (handler as unknown as (e: Event) => Promise<Result>)(event);

const signedIn: Event = { headers: { authorization: "Bearer good-token" } };

/** A feedback document as the collection holds it - only the fields this route
 * reads are spelled out. */
const report = (
  createdAt: string,
  overrides: Partial<Feedback> = {},
  qa: { itemId: string } | null = { itemId: "qa-changelog" },
) => ({
  data: () => ({
    kind: "bug",
    message: "nie działa",
    userUid: "me",
    createdAt,
    adminStatus: "new",
    context: {
      route: "/qa",
      ...(qa ? { qa: { ...qa, status: "issue" } } : {}),
    },
    ...overrides,
  }),
});

/** The route walks the query newest-first, so the fixtures arrive sorted the
 * way Firestore would return them. */
const returning = (docs: unknown[]) => mockGet.mockResolvedValue({ docs });

describe("/api/feedback/qa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: "me" });
    returning([]);
  });

  it("refuses a caller without a token", async () => {
    await expect(callHandler({})).rejects.toMatchObject({ statusCode: 401 });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("only ever reads the caller's own reports", async () => {
    await callHandler(signedIn);

    // The whole reason a non-admin may call this: the answer is about them and
    // cannot be widened by anything the caller sends.
    expect(mockWhere).toHaveBeenCalledWith("userUid", "==", "me");
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
  });

  it("keys what the admin decided by the changelog entry", async () => {
    returning([
      report("2026-08-20T10:00:00.000Z", { adminStatus: "resolved" }),
    ]);

    const result = await callHandler(signedIn);

    expect(result.resolutions).toEqual({
      "qa-changelog": {
        itemId: "qa-changelog",
        status: "resolved",
        reportedAt: "2026-08-20T10:00:00.000Z",
      },
    });
  });

  it("ignores reports that were not written about an entry", async () => {
    returning([
      report("2026-08-20T10:00:00.000Z", { adminStatus: "resolved" }, null),
    ]);

    // A report from the "Zgłoś" button belongs to /admin/opinie and to nothing
    // on /qa.
    expect((await callHandler(signedIn)).resolutions).toEqual({});
  });

  it("answers with the newest report on an entry, not the first", async () => {
    returning([
      report("2026-08-25T10:00:00.000Z", { adminStatus: "new" }),
      report("2026-08-20T10:00:00.000Z", { adminStatus: "resolved" }),
    ]);

    // This is what makes "nadal nie działa" clear the banner by itself: the
    // fresh, untriaged report outranks the closure it argues with.
    expect((await callHandler(signedIn)).resolutions["qa-changelog"]).toEqual({
      itemId: "qa-changelog",
      status: "new",
      reportedAt: "2026-08-25T10:00:00.000Z",
    });
  });

  it("treats a report from before the queue as untriaged", async () => {
    returning([
      report("2026-08-20T10:00:00.000Z", {
        adminStatus: undefined as never,
      }),
    ]);

    expect(
      (await callHandler(signedIn)).resolutions["qa-changelog"]?.status,
    ).toBe("new");
  });

  it("never hands the team's own triage note to the reporter", async () => {
    returning([
      report("2026-08-20T10:00:00.000Z", {
        adminStatus: "resolved",
        adminNote: "Jest lepiej, ale nie rozumiem o co chodzi",
        contact: "ktos@example.com",
      }),
    ]);

    const entry = (await callHandler(signedIn)).resolutions["qa-changelog"]!;

    // `adminNote` is where the team writes to itself; forwarding it would turn
    // a triage jotting into a reply nobody wrote.
    expect(Object.keys(entry).sort()).toEqual([
      "itemId",
      "reportedAt",
      "status",
    ]);
    expect(JSON.stringify(entry)).not.toContain("Jest lepiej");
  });

  it("caps how far back it reads", async () => {
    await callHandler(signedIn);
    expect(mockLimit).toHaveBeenCalledWith(200);
  });
});
