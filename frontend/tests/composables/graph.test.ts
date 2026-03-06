import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useGraph } from "~/composables/graph";

// Mock Nuxt / Vue composables
vi.mock("#app", () => ({
  useAsyncData: vi.fn((key, fetcher) => {
    return { data: ref(fetcher()) };
  }),
}));

const mockEdges = ref([
  { source: "A", target: "B" }, // A-B
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

vi.mock("~/composables/useEntityFiltering", () => ({
  useEntityFiltering: (r: any) => r,
}));

// We must override $fetch locally
global.$fetch = vi.fn(() => ({
  nodes: mockNodes.value,
  edges: mockEdges.value,
  nodeGroups: [],
})) as any;

describe("useGraph node expansion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return immediate neighbors when expandedNodes has 1 element (simulate single node click/focus)", async () => {
    const expandedNodes = ref(new Set(["A"]));
    const { nodesFiltered, edgesFiltered } = useGraph({
      focusNodeId: "A",
      expandedNodes,
    } as any);

    await flushPromises();

    // Should include A, B, C. D and E are too far.
    expect(Object.keys(nodesFiltered.value)).toEqual(["A", "B", "C"]);

    // Edges between A,B and A,C
    expect(edgesFiltered.value.length).toBe(2);
  });

  it("should expand graph when new nodes are added to expandedNodes", async () => {
    const expandedNodes = ref(new Set(["A"]));
    const { nodesFiltered, edgesFiltered } = useGraph({
      focusNodeId: "A",
      expandedNodes,
    } as any);

    await flushPromises();
    expect(Object.keys(nodesFiltered.value)).toEqual(["A", "B", "C"]);

    expandedNodes.value = new Set(["A", "C"]);
    await flushPromises();

    expect(Object.keys(nodesFiltered.value).sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(edgesFiltered.value.length).toBe(3);
  });
});
