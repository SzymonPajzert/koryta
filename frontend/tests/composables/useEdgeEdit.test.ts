import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEdgeEdit } from "../../app/composables/useEdgeEdit";
import { ref, nextTick, computed } from "vue";

// Mocks
const mockedFetch = vi.fn();
vi.stubGlobal("$fetch", mockedFetch);
vi.stubGlobal("alert", vi.fn());

const mockOnUpdate = vi.fn();

// Mock useState with actual shared state behavior
const stateMap = new Map<string, any>();
vi.mock("#app", () => ({
  useState: (key: string, init: () => any) => {
    if (!stateMap.has(key)) {
      stateMap.set(key, ref(init()));
    }
    return stateMap.get(key);
  },
}));

describe("useEdgeEdit", () => {
  let mockNodeId: string;
  let mockNodeType: string;
  let mockAuthHeaders: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockReset();

    mockNodeId = ref("node-123");
    mockNodeType = ref("person");
    mockAuthHeaders = ref({ Authorization: "Bearer token" });
  });

  it("initializes defaults", () => {
    const { newEdge, edgeType } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: mockNodeId.value,
        type: mockNodeType.value,
        name: "Test Node",
      })),
      authHeaders: mockAuthHeaders,
    });
    expect(newEdge.value.type).toBe("connection");
    expect(edgeType.value).toBe("connection");
  });

  describe("Edge Logic", () => {
    it("filters edge types for Person (direction-aware)", async () => {
      mockNodeType.value = "person";
      const { availableEdgeTypes, newEdge } = useEdgeEdit({
        fixedNode: computed(() => ({
          id: mockNodeId.value,
          type: mockNodeType.value,
          name: "Test Node",
        })),
        authHeaders: mockAuthHeaders,
        stateKey: ref("test-person-logic"),
      });

      // Person Outgoing (Default)
      // 'connection' (Source: Person) -> Include
      // 'employed' (Source: Person) -> Include
      const types = availableEdgeTypes.value.map((o) => o.value);
      expect(types).not.toContain("owns_parent");
      expect(types).toContain("connection");
      expect(types).toContain("employed");

      // Change to incoming
      newEdge.value.direction = "incoming";
      await nextTick();
      const typesIn = availableEdgeTypes.value.map((o) => o.value);

      // Person Incoming
      // 'connection' (Target: Person) -> Include
      // 'mentioned_person' (Target: Person) -> Include
      expect(typesIn).toContain("connection");
      expect(typesIn).toContain("mentioned_person");
      expect(typesIn).not.toContain("owns_parent");
      expect(typesIn).not.toContain("employed");
    });

    it("filters edge types for Place (direction-aware)", async () => {
      mockNodeType.value = "place";
      const { availableEdgeTypes, newEdge } = useEdgeEdit({
        fixedNode: computed(() => ({
          id: mockNodeId.value,
          type: mockNodeType.value,
          name: "Test Node",
        })),
        authHeaders: mockAuthHeaders,
        stateKey: ref("test-place-logic"),
      });

      // Place Outgoing (Default)
      // 'owns' (Source: Place) -> Include
      const types = availableEdgeTypes.value.map((o) => o.value);
      expect(types).toContain("owns_child");

      // Change to incoming
      newEdge.value.direction = "incoming";
      await nextTick();
      const typesIn = availableEdgeTypes.value.map((o) => o.value);

      // Place Incoming
      // 'owns' (Target: Place) -> Include
      // 'employed' (Target: Place) -> Include
      // 'mentioned_company' (Target: Place) -> Include
      expect(typesIn).toContain("owns_parent");
      expect(typesIn).toContain("employed");
      expect(typesIn).toContain("mentioned_company");
    });
  });

  describe("Edge Types Availability", () => {
    const cases = [
      {
        nodeType: "person",
        expectedOutgoing: ["connection", "employed"],
        expectedIncoming: ["connection", "mentioned_person"],
      },
      {
        nodeType: "place",
        expectedOutgoing: ["owns_child"],
        expectedIncoming: [
          "employed",
          "mentioned_company",
          "owns_parent",
          "owns_region",
        ],
      },
    ];

    for (const { nodeType, expectedOutgoing, expectedIncoming } of cases) {
      it(`lists correct edges for node type: ${nodeType} (outgoing)`, async () => {
        mockNodeType.value = nodeType;
        const { availableEdgeTypes, newEdge } = useEdgeEdit({
          fixedNode: computed(() => ({
            id: mockNodeId.value,
            type: mockNodeType.value,
            name: "Test Node",
          })),
          authHeaders: mockAuthHeaders,
          stateKey: ref(`test-${nodeType}-out`),
        });

        newEdge.value.direction = "outgoing";
        await nextTick();

        const values = availableEdgeTypes.value.map((x) => x.value);
        expect(values.sort()).toEqual(expectedOutgoing.sort());
      });

      it(`lists correct edges for node type: ${nodeType} (incoming)`, async () => {
        mockNodeType.value = nodeType;
        const { availableEdgeTypes, newEdge } = useEdgeEdit({
          fixedNode: computed(() => ({
            id: mockNodeId.value,
            type: mockNodeType.value,
            name: "Test Node",
          })),
          authHeaders: mockAuthHeaders,
          stateKey: ref(`test-${nodeType}-in`),
        });

        newEdge.value.direction = "incoming";
        await nextTick();

        const values = availableEdgeTypes.value.map((x) => x.value);
        expect(values.sort()).toEqual(expectedIncoming.sort());
      });
    }
  });

  it("adds edge", async () => {
    const { processEdge, newEdge, pickedNode, edgeType } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: mockNodeId.value,
        type: mockNodeType.value,
        name: "Test Node",
      })),
      authHeaders: mockAuthHeaders,
      onUpdate: mockOnUpdate,
      stateKey: ref("test-add-edge"),
    });

    newEdge.value.direction = "outgoing";
    edgeType.value = "employed";
    await nextTick();
    pickedNode.value = { id: "company-1" };
    mockedFetch.mockResolvedValueOnce({});

    await processEdge();

    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/edges/create",
      expect.objectContaining({
        body: expect.objectContaining({
          source: "node-123",
          target: "company-1",
          type: "employed",
        }),
      }),
    );
    expect(mockOnUpdate).toHaveBeenCalled();
  });

  it("populates layout with name when opening existing edge", async () => {
    const { openEditEdge, layout, newEdge } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: "node-1",
        type: "person",
        name: "Node 1",
      })),
      authHeaders: mockAuthHeaders,
    });

    const mockEdge: any = {
      type: "connection",
      source: "node-1",
      target: "node-2",
      richNode: {
        id: "node-2",
        type: "person",
        name: "Node 2 Name",
      },
    };

    openEditEdge(mockEdge);

    expect(newEdge.value.direction).toBe("outgoing");
    expect(layout.target.ref.value).toEqual({
      id: "node-2",
      type: "person",
      name: "Node 2 Name",
    });
  });
});

describe("useEdgeEdit - articles", () => {
  const nodeId = ref("test-article-id");
  const nodeType = ref("article" as const);
  const authHeaders = ref({});
  const onUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with empty references", () => {
    const { newEdge } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: nodeId.value,
        type: nodeType.value,
        name: "Test Article",
      })),
      authHeaders,
      onUpdate,
    });
    expect(newEdge.value.references).toEqual([]);
  });

  it("handles article mode in processEdge (adding reference edge)", async () => {
    const { pickedNode, processEdge, edgeType } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: nodeId.value,
        type: nodeType.value,
        name: "Test Article",
      })),
      authHeaders,
      onUpdate,
    });

    const mockFetch = vi.fn().mockResolvedValue({ id: "new-edge-id" });
    global.$fetch = mockFetch;

    edgeType.value = "mentioned_person";
    await nextTick();
    pickedNode.value = {
      id: "target-person",
      type: "person",
      name: "Target P",
    } as any;

    // newEdge.value.direction is default 'outgoing' -> Source=Fixed(Article), Target=Picked(Person)

    await processEdge();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/edges/create",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          // source should be nodeId (article)
          source: "test-article-id",
          target: "target-person",
          type: "mentions",
        }),
      }),
    );
  });

  it("filters available types (Article)", async () => {
    // Only check basic availability as sophisticated "3rd party edge" logic is removed
    const { availableEdgeTypes } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: nodeId.value,
        type: nodeType.value,
        name: "Test Article",
      })),
      authHeaders,
      onUpdate,
      stateKey: ref("test-article-filtering"),
    });

    // Article Source -> ?
    // default dir=outgoing
    // Should show types where Source=Article
    const types = availableEdgeTypes.value.map((o) => o.value);
    expect(types).toContain("mentioned_person");
    expect(types).toContain("mentioned_company");
    expect(types).not.toContain("employed"); // employed is Person->Place
  });
});

describe("Region as Parent", () => {
  const nodeId = ref("company-123");
  const nodeType = ref("place" as const);
  const authHeaders = ref({ Authorization: "Bearer token" });
  const onUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockReset();
  });

  it("transforms owns_region to owns type when saving edge", async () => {
    stateMap.clear();
    const { processEdge, newEdge, pickedNode, edgeType } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: nodeId.value,
        type: nodeType.value,
        name: "Test Place",
      })),
      authHeaders,
      onUpdate,
      stateKey: ref("test-region-save"),
    });

    // Set up as if we selected "owns_region" (incoming)
    // Target defaults to nodeId (the company), Source is chosen in pickerTarget because it's incoming
    newEdge.value.direction = "incoming";
    await nextTick();

    edgeType.value = "owns_region" as any;

    // layout should be src=picked, target=fixed (incoming to Place i.e. region->place)
    // Wait, owns: Source=Company, Target=Subsidiary
    // owns_region:  Source=Region, Target=Company
    // Incoming to Company = Region->Company

    pickedNode.value = { id: "region-1", type: "region" } as any;
    await nextTick();

    mockedFetch.mockResolvedValueOnce({});

    await processEdge();

    expect(global.$fetch as any).toHaveBeenCalledWith(
      "/api/edges/create",
      expect.objectContaining({
        body: expect.objectContaining({
          source: "region-1",
          target: "company-123",
          type: "owns", // Should be transformed from owns_region -> owns
        }),
      }),
    );
  });

  it("detects owns_region when opening existing edge edit", () => {
    const { openEditEdge, edgeType } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: nodeId.value,
        type: nodeType.value,
        name: "Test Place",
      })),
      authHeaders,
      stateKey: ref("test-region-edit"),
    });

    const mockEdge: any = {
      type: "owns",
      source: "region-1",
      target: "company-123",
      id: "edge-999",
      richNode: {
        id: "region-1",
        type: "region",
        name: "Some Region",
      },
    };

    openEditEdge(mockEdge);

    expect(edgeType.value).toBe("owns_region");
  });

  it("defaults to normal 'owns' if owner is company", () => {
    const { openEditEdge, edgeType } = useEdgeEdit({
      fixedNode: computed(() => ({
        id: nodeId.value,
        type: nodeType.value,
        name: "Test Place",
      })),
      authHeaders,
      stateKey: ref("test-company-edit"),
    });

    const mockEdge: any = {
      type: "owns",
      source: "company-parent",
      target: "company-123",
      id: "edge-999",
      richNode: {
        id: "company-parent",
        type: "place",
        name: "Parent Company",
      },
    };

    openEditEdge(mockEdge);

    expect(edgeType.value).toBe("owns_parent");
  });
});
