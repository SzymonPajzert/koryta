import { describe, it, expect, vi } from "vitest";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
vi.stubGlobal("defineEventHandler", (handler: any) => handler);
vi.stubGlobal(
  "defineCachedEventHandler",
  (handler: any, _options: any) => handler,
);
vi.stubGlobal("getUser", async (_event: any) => {
  return true;
});
vi.mock("~~/server/utils/fetch", () => ({
  fetchNodes: vi.fn(),
  fetchEdges: vi.fn(),
}));
describe("Graph API", () => {
  it("assembles graph correctly", async () => {
    // Setup mocks
    vi.mocked(fetchNodes).mockImplementation((type: string) => {
      if (type === "person")
        return Promise.resolve({ p1: { name: "Person 1", parties: ["PiS"] } });
      if (type === "place")
        return Promise.resolve({ c1: { name: "Company 1" } });
      if (type === "region") return Promise.resolve({});
      return Promise.resolve({});
    });

    vi.mocked(fetchEdges).mockResolvedValue([
      { source: "p1", target: "c1", type: "employed" },
    ]);

    const handlerModule = await import("../../../server/api/graph/index.get");
    const result = await handlerModule.default({} as any);

    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(result).toHaveProperty("nodeGroups");

    expect(result.nodes["p1"]).toBeDefined();
    expect(fetchNodes).toHaveBeenCalledTimes(3);
    expect(fetchEdges).toHaveBeenCalledTimes(1);
  });

  it("filters out empty regions and companies", async () => {
    vi.mocked(fetchNodes).mockImplementation((type: string) => {
      if (type === "person")
        return Promise.resolve({ p1: { name: "Person 1" } });
      if (type === "place")
        return Promise.resolve({ c1: { name: "Company 1" } }); // Empty company
      if (type === "region")
        return Promise.resolve({ r1: { name: "Region 1" } }); // Empty region
      return Promise.resolve({});
    });

    vi.mocked(fetchEdges).mockResolvedValue([]);

    const handlerModule = await import("../../../server/api/graph/index.get");
    const result = await handlerModule.default({} as any);

    // Filter should drop c1 and r1 from nodeGroups and nodes because they have 0 people connected
    expect(result.nodeGroups.find((g: any) => g.id === "c1")).toBeUndefined();
    expect(result.nodeGroups.find((g: any) => g.id === "r1")).toBeUndefined();

    expect(result.nodes["c1"]).toBeUndefined();
    expect(result.nodes["r1"]).toBeUndefined();
  });
});
