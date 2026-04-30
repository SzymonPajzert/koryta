import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useGraph } from "~/composables/graph";
import { clearNuxtData } from "#imports";

const mockEdges = ref([
  { source: "A", target: "C" }, // A-C
  { source: "C", target: "D" }, // C-D
  { source: "D", target: "E" }, // D-E
]);

const mockNodes = ref({
  A: { type: "circle", stats: { people: 1 } },
  B: { type: "circle", stats: { people: 1 } },
  C: { type: "circle", stats: { people: 1 } },
  D: { type: "circle", stats: { people: 1 } },
  E: { type: "circle", stats: { people: 1 } },
});

// We must override $fetch locally
global.$fetch = vi.fn(() => ({
  nodes: mockNodes.value,
  edges: mockEdges.value,
  nodeGroups: [],
})) as any;

describe("useGraph node expansion", () => {
  beforeEach(() => {
    // try specifically clearing $fetch
    (global.$fetch as any).mockClear();
    vi.clearAllMocks();
    clearNuxtData();
  });

  it("should evaluate local endpoint correctly based on single expanded node", async () => {
    // 1. Single node focus
    const expandedNodes = ref(new Set(["A"]));
    const { url } = useGraph({
      focusNodeId: "A",
      expandedNodes,
    } as any);

    expect(url.value).toBe("/api/graph/local/A?distance=1");
  });

  it("should evaluate local endpoint correctly based on multiple expanded nodes", async () => {
    // 2. Multiple expanded nodes focus
    const expandedNodes2 = ref(new Set(["A", "C", "D"]));
    const { url } = useGraph({
      focusNodeId: "A",
      expandedNodes: expandedNodes2,
    } as any);

    expect(url.value).toBe("/api/graph/local/A?distance=1&expand=C,D");
  });
});
