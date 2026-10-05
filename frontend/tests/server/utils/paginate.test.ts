import { describe, it, expect, vi } from "vitest";
import { fetchOptionsValidator, paginate } from "../../../server/utils/fetch";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // server/utils/fetch.ts wraps a Nitro auto-import at module load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(),
  Filter: { where: vi.fn(), or: vi.fn() },
}));

/** A query that records what it was narrowed by. */
function recordingQuery() {
  const calls: [string, number][] = [];
  const query = {
    offset: (n: number) => (calls.push(["offset", n]), query),
    limit: (n: number) => (calls.push(["limit", n]), query),
  };
  return { query: query as unknown as FirebaseFirestore.Query, calls };
}

describe("fetchOptionsValidator", () => {
  it("takes a page size and a page from the query string", () => {
    expect(fetchOptionsValidator.parse({ limit: "25", page: "3" })).toEqual({
      limit: 25,
      page: 3,
    });
  });

  // Vuetify's "all rows" option asks for `limit=-1`, which Firestore throws
  // on - a 500 for what is a bad request.
  it.each([["-1"], ["0"], ["2.5"]])("refuses limit=%s", (limit) => {
    expect(fetchOptionsValidator.safeParse({ limit }).success).toBe(false);
  });

  it("refuses page=0", () => {
    expect(
      fetchOptionsValidator.safeParse({ limit: "10", page: "0" }).success,
    ).toBe(false);
  });
});

describe("paginate", () => {
  it("skips the pages before the one asked for", () => {
    const { query, calls } = recordingQuery();
    paginate(query, { limit: 25, page: 3 });
    expect(calls).toEqual([
      ["offset", 50],
      ["limit", 25],
    ]);
  });

  it("leaves the query whole when no page size is asked for", () => {
    const { query, calls } = recordingQuery();
    expect(paginate(query, {})).toBe(query);
    expect(calls).toEqual([]);
  });

  // For the routes with a query schema of their own, which do not go through
  // `fetchOptionsValidator`.
  it.each([[{ limit: -1 }], [{ limit: 2.5 }], [{ limit: 10, page: -2 }]])(
    "answers %o with a 400 instead of handing it to Firestore",
    (options) => {
      const { query, calls } = recordingQuery();
      expect(() => paginate(query, options)).toThrow(
        expect.objectContaining({ statusCode: 400 }),
      );
      expect(calls).toEqual([]);
    },
  );
});
