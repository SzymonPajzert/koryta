import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/comments/list.get";

const { wheres, docs } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.defineEventHandler = (fn: unknown) => fn;

  return {
    wheres: [] as unknown[][],
    docs: [] as { id: string; data: () => Record<string, unknown> }[],
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => {
      const query: Record<string, unknown> = {
        where: (...args: unknown[]) => {
          wheres.push(args);
          return query;
        },
        limit: () => query,
        get: async () => ({ docs }),
      };
      return query;
    },
  }),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

// Recorded rather than merely stubbed, as in stats-hospitals.test.ts: which
// wrapper this route uses is the whole difference between an author seeing the
// comment they just posted and being served the list from before it, and the
// wrapping happens once, at import, before any `beforeEach`.
const { wrappedWith } = vi.hoisted(() => ({ wrappedWith: [] as string[] }));
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("authCachedEventHandler");
    return fn;
  },
  editorFreshCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("editorFreshCachedEventHandler");
    return fn;
  },
}));

let query: Record<string, string> = {};
(globalThis as Record<string, unknown>).getQuery = () => query;

const call = () =>
  (handler as unknown as (event: unknown) => Promise<{ id: string }[]>)({});

const comment = (id: string, createdAt: string) => ({
  id,
  data: () => ({ content: id, nodeId: "person-1", createdAt }),
});

beforeEach(() => {
  wheres.length = 0;
  docs.length = 0;
  query = {};
});

describe("/api/comments/list", () => {
  it("reads a signed-in reader's list through the cache", () => {
    // „Dodałem testowy komentarz, ale nie jest widoczny” - the reporter took
    // it for moderation. Nothing moderates a comment: the list was held for
    // six hours for everybody, its author included, because the plain cached
    // wrapper never looks at who is asking. `editorFresh` answers the
    // `latest=true` every signed-in request carries from Firestore, and still
    // serves everybody else from the cache.
    expect(wrappedWith).toEqual(["editorFreshCachedEventHandler"]);
  });

  it("lists one page's comments, oldest first", async () => {
    query = { nodeId: "person-1" };
    docs.push(
      comment("later", "2026-09-18T11:42:10Z"),
      comment("earlier", "2026-09-01T08:00:00Z"),
    );

    const comments = await call();

    expect(wheres).toEqual([["nodeId", "==", "person-1"]]);
    expect(comments.map((each) => each.id)).toEqual(["earlier", "later"]);
  });
});
