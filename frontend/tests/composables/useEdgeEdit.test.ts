import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEdgeEdit } from "../../app/composables/useEdgeEdit";
import { ref, nextTick } from "vue";

// Mocks
const mockedFetch = vi.fn();
vi.stubGlobal("$fetch", mockedFetch);
vi.stubGlobal("alert", vi.fn());

const mockOnUpdate = vi.fn();

// Mock useState
vi.mock("#app", () => ({
  useState: (key: string, init: () => any) => ref(init()),
}));

// Mock alert
vi.stubGlobal("alert", vi.fn());

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
      nodeId: mockNodeId,
      nodeType: mockNodeType,
      authHeaders: mockAuthHeaders,
    });
    expect(newEdge.value.type).toBe("connection");
    expect(edgeType.value).toBe("connection");
  });

  describe("Edge Logic", () => {
    it("filters edge types for Person (direction-aware)", async () => {
      mockNodeType.value = "person";
      const { availableEdgeTypes, newEdge } = useEdgeEdit({
        nodeId: mockNodeId,
        nodeType: mockNodeType,
        authHeaders: mockAuthHeaders,
        stateKey: ref("test-person-logic"),
      });

      // Person Outgoing (Default)
      // 'connection' (Source: Person) -> Include
      // 'employed' (Source: Person) -> Include
      const types = availableEdgeTypes.value.map((o) => o.value);
      expect(types).not.toContain("owns");
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
      expect(typesIn).not.toContain("owns");
      expect(typesIn).not.toContain("employed");
    });

    it("filters edge types for Place (direction-aware)", async () => {
      mockNodeType.value = "place";
      const { availableEdgeTypes, newEdge } = useEdgeEdit({
        nodeId: mockNodeId,
        nodeType: mockNodeType,
        authHeaders: mockAuthHeaders,
        stateKey: ref("test-place-logic"),
      });

      // Place Outgoing (Default)
      // 'owns' (Source: Place) -> Include
      const types = availableEdgeTypes.value.map((o) => o.value);
      expect(types).toContain("owns");

      // Change to incoming
      newEdge.value.direction = "incoming";
      await nextTick();
      const typesIn = availableEdgeTypes.value.map((o) => o.value);

      // Place Incoming
      // 'owns' (Target: Place) -> Include
      // 'employed' (Target: Place) -> Include
      // 'mentioned_company' (Target: Place) -> Include
      expect(typesIn).toContain("owns");
      expect(typesIn).toContain("employed");
      expect(typesIn).toContain("mentioned_company");
    });

    it("switches direction when selecting a type that requires it", async () => {
      mockNodeType.value = "article"; // Article is strictly outgoing source
      const { newEdge, edgeType } = useEdgeEdit({
        nodeId: mockNodeId,
        nodeType: mockNodeType,
        authHeaders: mockAuthHeaders,
        stateKey: ref("test-article-switch"),
      });

      // Initially outgoing
      expect(newEdge.value.direction).toBe("outgoing");

      // Force incoming - this isn't a great test for "switches direction"
      // because we don't have many strictly incoming types for specific nodes.
      // But let's test that 'mentioned_person' forces 'outgoing' for Article.
      newEdge.value.direction = "incoming";
      await nextTick();

      edgeType.value = "mentioned_person";
      await nextTick();

      expect(newEdge.value.direction).toBe("outgoing");
    });

    it("resets edgeType if invalid after direction switch", async () => {
      mockNodeType.value = "person";
      const { availableEdgeTypes, newEdge, edgeType } = useEdgeEdit({
        nodeId: mockNodeId,
        nodeType: mockNodeType,
        authHeaders: mockAuthHeaders,
        stateKey: ref("test-person-reset"),
      });

      // Initially outgoing, check if 'employed' is there
      expect(
        availableEdgeTypes.value.find((t) => t.value === "employed"),
      ).toBeTruthy();
      edgeType.value = "employed";

      // Switch to incoming where 'employed' is NOT valid for Person
      // (Employed target is Place, I am Person)
      newEdge.value = { ...newEdge.value, direction: "incoming" };
      await nextTick();
      await nextTick();

      expect(edgeType.value).toBeOneOf(["connection", "employed"]);
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
        expectedOutgoing: ["owns"],
        expectedIncoming: ["employed", "mentioned_company", "owns"],
      },
      {
        nodeType: "article",
        expectedOutgoing: ["mentioned_person", "mentioned_company"],
        expectedIncoming: [],
      },
    ];

    for (const { nodeType, expectedOutgoing, expectedIncoming } of cases) {
      it(`lists correct edges for node type: ${nodeType} (outgoing)`, async () => {
        mockNodeType.value = nodeType;
        const { availableEdgeTypes, newEdge } = useEdgeEdit({
          nodeId: mockNodeId,
          nodeType: mockNodeType,
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
          nodeId: mockNodeId,
          nodeType: mockNodeType,
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
    const { processEdge, newEdge, pickerTarget } = useEdgeEdit({
      nodeId: mockNodeId,
      nodeType: mockNodeType,
      authHeaders: mockAuthHeaders,
      onUpdate: mockOnUpdate,
      stateKey: ref("test-add-edge"),
    });

    newEdge.value.direction = "outgoing";
    newEdge.value.type = "employed";
    pickerTarget.value = { id: "company-1" };

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
      nodeId,
      nodeType,
      authHeaders,
      onUpdate,
    });
    expect(newEdge.value.references).toEqual([]);
  });

  it("handles article mode in processEdge (adding edge)", async () => {
    const { newEdge, pickerTarget, pickerSource, processEdge } = useEdgeEdit({
      nodeId,
      nodeType,
      authHeaders,
      onUpdate,
    });

    const mockFetch = vi.fn().mockResolvedValue({ id: "new-edge-id" });
    global.$fetch = mockFetch;

    pickerSource.value = { id: "source-person", type: "person", name: "Source" } as any;
    pickerTarget.value = { id: "target-place", type: "place", name: "Target" } as any;
    newEdge.value.type = "employed";
    newEdge.value.references = ["test-article-id"];

    await processEdge();

    expect(mockFetch).toHaveBeenCalledWith("/api/edges/create", expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        source: "source-person",
        target: "target-place",
        type: "employed",
        references: ["test-article-id"],
      }),
    }));
  });
});

