import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchEdgesClose } from "../../../server/utils/fetch";

/** The filters each query was built with, one list per query. */
const built = vi.hoisted(() => {
  // server/utils/fetch.ts caches a function of its own at load time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
  return { queries: [] as [string, string, unknown][][] };
});

function query(filters: [string, string, unknown][]) {
  return {
    where: (field: string, op: string, value: unknown) =>
      query([...filters, [field, op, value]]),
    get: async () => {
      built.queries.push(filters);
      return { docs: [] };
    },
  };
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => query([]) }),
  Filter: {},
}));

beforeEach(() => {
  built.queries.length = 0;
});

describe("fetchEdgesClose", () => {
  it("asks for every relation of the nodes, from either end", async () => {
    await fetchEdgesClose(["teryt14"]);
    expect(built.queries).toEqual([
      [["source", "in", ["teryt14"]]],
      [["target", "in", ["teryt14"]]],
    ]);
  });

  it("leaves one type of relation out of both queries", async () => {
    // A region page's candidacies, which its lists read on their own.
    await fetchEdgesClose(["teryt14"], "election");
    expect(built.queries).toEqual([
      [
        ["source", "in", ["teryt14"]],
        ["type", "!=", "election"],
      ],
      [
        ["target", "in", ["teryt14"]],
        ["type", "!=", "election"],
      ],
    ]);
  });
});
