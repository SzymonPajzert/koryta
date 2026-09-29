import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/stats/companies.get";

type Doc = { id: string; data: Record<string, unknown> };
type QueryCall = {
  collection: string;
  wheres: [string, string, unknown][];
  selects: string[];
  limit?: number;
};

const { cacheOptions, queries, nodeDocs, edgeDocs } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  const cacheOptions: Record<string, unknown>[] = [];
  // Recorded rather than merely unwrapped: which cache this endpoint sits
  // behind is the difference between one computation every six hours and one
  // per signed-in page view, so it is asserted below. A plain array filled at
  // import time, before any `beforeEach` could clear a spy.
  globals.defineCachedFunction = (
    fn: unknown,
    options: Record<string, unknown>,
  ) => {
    cacheOptions.push(options);
    return fn;
  };
  globals.defineEventHandler = (fn: unknown) => fn;
  return {
    cacheOptions,
    queries: [] as QueryCall[],
    nodeDocs: [] as Doc[],
    edgeDocs: [] as Doc[],
  };
});

// The recorded `where`s are applied rather than ignored: that the handler
// asks only for published documents is what keeps drafts out of the counts.
vi.mock("firebase-admin/firestore", () => {
  const collection = (name: string) => {
    const call: QueryCall = { collection: name, wheres: [], selects: [] };
    queries.push(call);
    const query = {
      where: (field: string, op: string, value: unknown) => {
        call.wheres.push([field, op, value]);
        return query;
      },
      select: (...fields: string[]) => {
        call.selects.push(...fields);
        return query;
      },
      limit: (n: number) => {
        call.limit = n;
        return query;
      },
      get: async () => {
        const docs = (name === "nodes" ? nodeDocs : edgeDocs)
          .filter((doc) =>
            call.wheres.every(([field, op, value]) => {
              if (op !== "==") {
                throw new Error(`the mock does not know the "${op}" operator`);
              }
              return doc.data[field] === value;
            }),
          )
          .slice(0, call.limit ?? Infinity);
        return {
          size: docs.length,
          docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })),
        };
      },
    };
    return query;
  };
  return { getFirestore: () => ({ collection }) };
});

vi.mock("firebase-functions/logger", () => ({ logger: { warn: vi.fn() } }));

// The region list the handler drops urzędy by, from nitro's cached copy.
vi.mock("~~/server/utils/fetch", () => ({
  fetchNodes: vi.fn(async () => ({ teryt1261: { name: "Kraków" } })),
}));

const call = () =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({});

const person = (id: string, extra: Record<string, unknown> = {}): Doc => ({
  id,
  data: { type: "person", published: true, ...extra },
});

const employment = (
  id: string,
  source: string,
  target: string,
  extra: Record<string, unknown> = {},
): Doc => ({
  id,
  data: { type: "employed", published: true, source, target, ...extra },
});

beforeEach(() => {
  queries.length = 0;
  nodeDocs.length = 0;
  edgeDocs.length = 0;
});

describe("/api/stats/companies", () => {
  it("is cached for six hours under one key, for everybody alike", () => {
    // Not `editorFreshCachedEventHandler`: the answer counts published people
    // only, so an editor is owed exactly what a guest gets, and a signed-in
    // reader's `latest=true` must not send every page view past the cache -
    // that is what cost /api/stats/hospitals 47,056 reads in 28 hours. And not
    // keyed on the url, where any `?x=1` would be a cold computation of its
    // own.
    expect(cacheOptions).toHaveLength(1);
    const [options] = cacheOptions as [Record<string, unknown>];
    expect(options).toMatchObject({
      name: "stats-companies",
      maxAge: 21600,
      swr: true,
    });
    expect(
      (options.getKey as (...args: unknown[]) => string)("?latest=true"),
    ).toBe("all");
  });

  it("reads the published employments and the published people, projected", async () => {
    await call();

    expect(queries).toEqual([
      {
        collection: "edges",
        wheres: [
          ["type", "==", "employed"],
          ["published", "==", true],
        ],
        selects: [
          "source",
          "target",
          "start_date",
          "end_date",
          "published",
          "deleted",
        ],
        limit: 20000,
      },
      {
        collection: "nodes",
        wheres: [
          ["type", "==", "person"],
          ["published", "==", true],
        ],
        selects: ["published", "deleted"],
      },
    ]);
  });

  it("counts published people at each institution", async () => {
    nodeDocs.push(
      person("anna"),
      person("bartek"),
      // A draft, and a page merged away that kept its flag: neither is a
      // person the site shows.
      person("draft", { published: false }),
      person("merged", { deleted: true }),
    );
    edgeDocs.push(
      employment("e1", "anna", "pkp", {
        start_date: "2019-03-01",
        end_date: "2023-01-31",
      }),
      employment("e2", "bartek", "pkp", { start_date: "2024-04-12" }),
      employment("e3", "draft", "pkp", { start_date: "2025-01-01" }),
      employment("e4", "merged", "pkp"),
      employment("e5", "anna", "plk", { published: false }),
      // A post in a region's urząd: not an institution the view lists.
      employment("e6", "anna", "teryt1261"),
    );

    const result = (await call()) as {
      generatedAt: string;
      companies: Record<string, unknown>;
    };

    expect(result.companies).toEqual({
      pkp: { people: 2, current: 1, latestStart: "2024-04-12" },
    });
    expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
  });
});
