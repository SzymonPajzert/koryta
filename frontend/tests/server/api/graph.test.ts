import { describe, it, expect, vi } from "vitest";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.stubGlobal("defineEventHandler", (handler: any) => handler);
vi.stubGlobal(
  "defineCachedEventHandler",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (handler: any, _options: any) => handler,
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      if (type === "article") return Promise.resolve({});
      return Promise.resolve({});
    });

    vi.mocked(fetchEdges).mockResolvedValue([
      { from: "p1", to: "c1", type: "work" },
    ]);

    const handlerModule = await import("../../../server/api/graph/index.get");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handlerModule.default({} as any);

    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(result).toHaveProperty("nodeGroups");

    expect(result.nodes["p1"]).toBeDefined();
    expect(fetchNodes).toHaveBeenCalledTimes(2);
    expect(fetchEdges).toHaveBeenCalledTimes(1);
  });
});
