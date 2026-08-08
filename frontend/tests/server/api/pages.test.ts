import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/pages/index.get";

const { capturesQuery, verifyIdToken } = vi.hoisted(() => {
  globalThis.createError = (err: any) => err;
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.getRequestHeader = () => "Bearer token-under-test";
  globalThis.getValidatedQuery = async (event: any, parser: any) =>
    parser(event.query ?? {});

  // Chainable recorder, as in extractions.test.ts: every builder call is kept
  // so the filter can be asserted on without a Firestore instance.
  const calls: Array<[string, unknown[]]> = [];
  const capturesQuery: any = { calls, docs: [] };
  for (const method of ["where", "orderBy", "limit"]) {
    capturesQuery[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, args]);
      return capturesQuery;
    });
  }
  capturesQuery.get = vi.fn(async () => ({ docs: capturesQuery.docs }));

  return {
    capturesQuery,
    verifyIdToken: vi
      .fn()
      .mockResolvedValue({ uid: "test-user-id", datascience: true }),
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => capturesQuery }),
}));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
// server/utils/auth stays real, so the datascience gate below is the one the
// endpoint actually runs; only the token lookup is faked.
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken }) }));

describe("GET /api/pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturesQuery.calls.length = 0;
    capturesQuery.docs = [];
    verifyIdToken.mockResolvedValue({ uid: "test-user-id", datascience: true });
  });

  function normalizedArg(index = 0) {
    const wheres = capturesQuery.calls.filter(
      ([method, args]: [string, unknown[]]) =>
        method === "where" && args[0] === "normalizedUrl",
    );
    return wheres[index]?.[1][2];
  }

  it("matches a capture across the spellings of one url", async () => {
    // The capture is filed under whatever the page claims as canonical, and the
    // lookup arrives from a browser. `normalizeUrl` is what makes the scheme,
    // a leading www. and a trailing slash stop mattering.
    await handler({ query: { url: "https://www.example.pl/artykuł/" } } as any);
    await handler({ query: { url: "example.pl/artykuł" } } as any);

    expect(normalizedArg(0)).toBe(normalizedArg(1));
  });

  it("keeps the query string, which is an article id on some sites", async () => {
    // Deliberate, and the reason the extension asks the page for its canonical
    // url rather than passing the address bar: dropping the query here would
    // merge genuinely different articles.
    await handler({ query: { url: "https://example.pl/a?id=7" } } as any);
    expect(normalizedArg(0)).toContain("id=7");
  });

  it("does not filter by url unless asked", async () => {
    await handler({ query: {} } as any);
    expect(capturesQuery.where).not.toHaveBeenCalled();
  });

  it("still serves newest first, limited", async () => {
    await handler({ query: { url: "https://example.pl/a" } } as any);
    expect(capturesQuery.calls).toContainEqual([
      "orderBy",
      ["capturedAt", "desc"],
    ]);
    expect(capturesQuery.limit).toHaveBeenCalledWith(200);
  });

  it("refuses a caller outside the datascience group", async () => {
    verifyIdToken.mockResolvedValue({ uid: "someone", datascience: false });
    await expect(handler({ query: {} } as any)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
