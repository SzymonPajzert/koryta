import { describe, it, expect, vi } from "vitest";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import handlerModule from "~~/server/api/graph/nodeGroups.get";

vi.hoisted(() => {
  globalThis.defineEventHandler = (handler: any) => handler;
  globalThis.defineCachedEventHandler = (handler: any, _options: any) =>
    handler;
  globalThis.getUser = async (_event: any) => {
    return true;
  };
});

// Assuming authCachedEventHandler is imported and wrappers are there
vi.mock("~~/server/utils/fetch", () => ({
  fetchNodes: vi.fn(),
  fetchEdges: vi.fn(),
}));

describe("Graph NodeGroups API", () => {
  it("does not leak candidate's graph into region through election edge", async () => {
    vi.mocked(fetchNodes).mockImplementation(async (type: string) => {
      if (type === "person")
        return {
          p1: { name: "Candidate", parties: [] },
          p2: { name: "Friend", parties: [] },
        };
      if (type === "place") return {};
      if (type === "region")
        return {
          r1: { name: "Region", type: "region" },
        };
      return {};
    });

    vi.mocked(fetchEdges).mockResolvedValue([
      { source: "p1", target: "r1", type: "election" },
      { source: "p1", target: "p2", type: "connection" },
    ]);

    const result = await handlerModule({} as any);

    // The handler returns a list of {id, name, people}
    const regionObj = result.find((g: any) => g.id === "r1");
    expect(regionObj).toBeDefined();

    // The region's `people` count should just be 1 (p1). p2 should not be included.
    expect(regionObj?.people).toBe(1);
  });
});
