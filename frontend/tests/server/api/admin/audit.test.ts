import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/admin/audit.get";

let stored: Record<string, Record<string, unknown> | undefined> = {};

/** What the audit query asked for, so a test can say the ordering is the one
 * the automatic single-field index serves. */
const mockOrderBy = vi.fn();

/** Every audit document, newest first, honouring startAfter/limit for real.
 * The endpoint's paging logic is the thing under test, so the fake has to
 * page rather than hand back everything. */
function auditQuery() {
  let afterAt: string | null = null;
  let afterId: string | null = null;
  let cap = Infinity;
  const query = {
    orderBy: (field: string, dir: string) => {
      mockOrderBy(field, dir);
      return query;
    },
    // Two keys, the way the endpoint orders: `(at, __name__)` both descending.
    startAfter: (at: string, id: string) => {
      afterAt = at;
      afterId = id;
      return query;
    },
    limit: (n: number) => {
      cap = n;
      return query;
    },
    get: async () => {
      const docs = Object.entries(stored)
        .filter(([path]) => path.startsWith("audit/"))
        .map(([path, data]) => ({
          id: path.slice("audit/".length),
          data: () => data as Record<string, unknown>,
        }))
        .sort((a, b) => {
          const byAt = String(b.data().at).localeCompare(String(a.data().at));
          return byAt !== 0 ? byAt : b.id.localeCompare(a.id);
        })
        .filter((doc) => {
          if (afterAt === null) return true;
          const at = String(doc.data().at);
          if (at !== afterAt) return at < afterAt;
          // Inside one timestamp the document id is what the cursor addresses.
          return doc.id < (afterId ?? "");
        })
        .slice(0, cap);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
  return query;
}

const mockDb = {
  collection: vi.fn((name: string) => ({
    doc: vi.fn((id: string) => ({ id, path: `${name}/${id}` })),
    ...(name === "audit" ? auditQuery() : {}),
  })),
  getAll: vi.fn(async (...refs: { id: string; path: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: stored[ref.path] !== undefined,
      data: () => stored[ref.path],
    })),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => ({}) },
  FieldValue: { delete: () => "deleted" },
  FieldPath: { documentId: () => "__name__" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockGetValidatedQuery } = vi.hoisted(() => {
  const mockGetValidatedQuery = vi.fn();
  globalThis.getValidatedQuery = mockGetValidatedQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetValidatedQuery };
});

function request(query: Record<string, unknown> = {}) {
  mockGetValidatedQuery.mockImplementation(
    async (_event: unknown, parse: (q: unknown) => unknown) => {
      try {
        return parse(query);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

function auditRow(
  id: string,
  at: string,
  fields: Record<string, unknown> = {},
) {
  stored[`audit/${id}`] = {
    action: "delete",
    collection: "edges",
    target_id: "e1",
    user: "admin-uid",
    at,
    ...fields,
  };
}

describe("api/admin/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    request();
  });

  it("returns the newest decision first", async () => {
    auditRow("old", "2026-01-01T00:00:00.000Z");
    auditRow("new", "2026-06-01T00:00:00.000Z");

    const result = await handler({} as never);

    expect(result.entries.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("orders on `at` alone, which the automatic index serves", async () => {
    // `audit` has no composite index and index deploys here are manual, so a
    // filter combined with the ordering would pass against the emulator - which
    // creates indexes implicitly - and 500 in production.
    auditRow("a", "2026-01-01T00:00:00.000Z");

    await handler({} as never);

    // Both descending, which is the shape of the automatic single-field index
    // (it terminates in `__name__` in the matching direction), so this needs no
    // composite index - and `audit` has none declared.
    expect(mockOrderBy.mock.calls).toEqual([
      ["at", "desc"],
      ["__name__", "desc"],
    ]);
  });

  it("names a relation by its two ends", async () => {
    auditRow("a", "2026-01-01T00:00:00.000Z", { reason: "Zły scalony" });
    stored["edges/e1"] = {
      source: "p1",
      target: "c1",
      type: "employed",
      deleted: true,
      start_date: "2019-03-01",
      end_date: "2024-04-12",
    };
    stored["nodes/p1"] = { name: "Jan Kowalski", type: "person" };
    stored["nodes/c1"] = { name: "Orlen", type: "place" };

    const result = await handler({} as never);

    expect(result.entries[0]).toMatchObject({
      targetName: "Jan Kowalski - Zatrudniony/a w - Orlen",
      targetDetail: "2019-03-01 - 2024-04-12",
      reason: "Zły scalony",
    });
    // A relation has no page; the end it starts from is where a reader would go.
    expect(result.entries[0]?.targetPath).toContain("p1");
  });

  it("offers a restore only while the relation is still removed", async () => {
    auditRow("gone", "2026-02-01T00:00:00.000Z", { target_id: "e1" });
    auditRow("back", "2026-01-01T00:00:00.000Z", { target_id: "e2" });
    stored["edges/e1"] = {
      source: "p1",
      target: "c1",
      type: "employed",
      deleted: true,
    };
    // Already restored by somebody else - the row stands, the button does not.
    stored["edges/e2"] = { source: "p1", target: "c1", type: "employed" };

    const result = await handler({} as never);

    expect(result.entries.find((e) => e.id === "gone")?.restorable).toBe(true);
    expect(result.entries.find((e) => e.id === "back")?.restorable).toBe(false);
  });

  it("does not offer a restore on a decision that removed nothing", async () => {
    auditRow("pub", "2026-01-01T00:00:00.000Z", { action: "publish" });
    stored["edges/e1"] = {
      source: "p1",
      target: "c1",
      type: "employed",
      deleted: true,
    };

    const result = await handler({} as never);

    expect(result.entries[0]?.restorable).toBe(false);
  });

  it("survives a target that is no longer there", async () => {
    // The decision was still made, so the row still stands.
    auditRow("a", "2026-01-01T00:00:00.000Z");

    const result = await handler({} as never);

    expect(result.entries[0]).toMatchObject({
      targetName: null,
      targetPath: null,
      restorable: false,
    });
  });

  it("filters to one kind of decision", async () => {
    auditRow("d", "2026-03-01T00:00:00.000Z", { action: "delete" });
    auditRow("p", "2026-02-01T00:00:00.000Z", { action: "publish" });
    request({ action: "delete" });

    const result = await handler({} as never);

    expect(result.entries.map((e) => e.id)).toEqual(["d"]);
  });

  it("pages through a group that all shares one millisecond without losing a row", async () => {
    // The reason the cursor carries a document id. `at` is stamped per
    // `recordAudit` call, and publishing a hundred relations files up to two
    // hundred rows inside one synchronous loop - tens of them on the same
    // millisecond. On `at` alone a cursor cannot address a position inside such
    // a group, so `startAfter(at)` stepped over whatever did not fit the page.
    const at = "2026-02-01T00:00:00.000Z";
    for (let i = 0; i < 7; i++) auditRow(`row${i}`, at);
    request({ limit: 2 });

    const seen: string[] = [];
    let cursor: string | null | undefined;
    for (let pageNo = 0; pageNo < 10; pageNo++) {
      request({ limit: 2, ...(cursor ? { cursor } : {}) });
      const result = await handler({} as never);
      seen.push(...result.entries.map((e) => e.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(seen.sort()).toEqual([
      "row0",
      "row1",
      "row2",
      "row3",
      "row4",
      "row5",
      "row6",
    ]);
    // And each exactly once.
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("does not repeat the last row of a page on the next one", async () => {
    auditRow("a", "2026-03-01T00:00:00.000Z");
    auditRow("b", "2026-02-01T00:00:00.000Z");
    request({ limit: 1 });

    const first = await handler({} as never);
    request({ limit: 1, cursor: first.nextCursor! });
    const second = await handler({} as never);

    expect(first.entries.map((e) => e.id)).toEqual(["a"]);
    expect(second.entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("stops paging when the log runs out", async () => {
    auditRow("a", "2026-01-01T00:00:00.000Z");

    const result = await handler({} as never);

    expect(result.nextCursor).toBeNull();
  });

  it("resumes after the cursor", async () => {
    auditRow("a", "2026-03-01T00:00:00.000Z");
    auditRow("b", "2026-02-01T00:00:00.000Z");
    request({ cursor: "2026-03-01T00:00:00.000Z|a" });

    const result = await handler({} as never);

    expect(result.entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("keeps paging when a filter matches nothing in the window it read", async () => {
    // The filter runs in memory over a bounded scan, so a rare decision can sit
    // behind any number of publications. Reporting the log exhausted the moment
    // one window happens to hold none of them would hide it for good.
    for (let i = 0; i < 3; i++) {
      auditRow(`p${i}`, `2026-0${i + 1}-01T00:00:00.000Z`, {
        action: "publish",
      });
    }
    request({ action: "delete", limit: 2 });

    const result = await handler({} as never);

    expect(result.entries).toEqual([]);
    // The cursor follows what was examined, not what was returned.
    expect(result.nextCursor).toBeNull();
  });

  it("advances the cursor past rows it examined but did not return", async () => {
    // Same rule, with the scan actually full: the next page has to resume after
    // the publications rather than re-reading them forever.
    auditRow("p1", "2026-03-01T00:00:00.000Z", { action: "publish" });
    auditRow("p2", "2026-02-01T00:00:00.000Z", { action: "publish" });
    auditRow("d1", "2026-01-01T00:00:00.000Z", { action: "delete" });
    request({ action: "delete", limit: 2 });

    const result = await handler({} as never);

    expect(result.entries.map((e) => e.id)).toEqual(["d1"]);
  });

  it("refuses a caller who is not an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
