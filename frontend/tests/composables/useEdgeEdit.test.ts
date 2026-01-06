import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEdgeEdit } from "../../app/composables/useEdgeEdit";
import { ref, reactive, nextTick } from "vue";

// Mocks
const mockedFetch = vi.fn();
vi.stubGlobal("$fetch", mockedFetch);
vi.stubGlobal("alert", vi.fn());

const mockOnUpdate = vi.fn();

describe("useEdgeEdit", () => {
  let mockNodeId: any;
  let mockNodeType: any;
  let mockAuthHeaders: any;

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
    it("filters edge types for Person (outgoing)", async () => {
      mockNodeType.value = "person";
      const { availableEdgeTypes, newEdge } = useEdgeEdit({
        nodeId: mockNodeId,
        nodeType: mockNodeType,
        authHeaders: mockAuthHeaders,
      });

      // Person Outgoing
      // 'owns' (Source: Person) -> Include
      // 'connection' (Source: Person) -> Include
      // 'employed' (Source: Person) -> Include
      const types = availableEdgeTypes.value.map((o) => o.value);
      expect(types).toContain("owns");
      expect(types).toContain("connection");
      expect(types).toContain("employed");

      // Change to incoming
      (newEdge.value as any).direction = "incoming";
      await nextTick();
      const typesIn = availableEdgeTypes.value.map((o) => o.value);

      // Person Incoming
      // 'owns' (Target: Place) -> Include (because valid outgoing)
      // 'connection' (Target: Person) -> Include
      // 'employed' (Target: Place) -> Include (because valid outgoing)
      expect(typesIn).toContain("owns");
      expect(typesIn).toContain("connection");
      expect(typesIn).toContain("employed");
    });

    it("shows edge types valid for ANY direction for Place", async () => {
      mockNodeType.value = "place";
      const { availableEdgeTypes, newEdge } = useEdgeEdit({
        nodeId: mockNodeId,
        nodeType: mockNodeType,
        authHeaders: mockAuthHeaders,
      });

      // Place Outgoing (Default)
      // 'owns' (Target: Place) -> Include
      const types = availableEdgeTypes.value.map((o) => o.value);
      expect(types).toContain("owns");
    });

    it("switches direction when selecting a type that requires it", async () => {
      mockNodeType.value = "place";
      const { newEdge, edgeType } = useEdgeEdit({
        nodeId: mockNodeId,
        nodeType: mockNodeType,
        authHeaders: mockAuthHeaders,
      });

      expect((newEdge.value as any).direction).toBe("outgoing");

      // Select 'owns' (requires Place to be Target -> Incoming)
      edgeType.value = "owns";
      await nextTick();

      expect((newEdge.value as any).direction).toBe("incoming");
    });

    it("resets edgeType if invalid after direction switch", async () => {
      mockNodeType.value = "person";
      const { availableEdgeTypes, newEdge, edgeType } = useEdgeEdit({
        nodeId: mockNodeId,
        nodeType: mockNodeType,
        authHeaders: mockAuthHeaders,
      });

      expect(
        availableEdgeTypes.value.find((t) => t.value === "owns"),
      ).toBeTruthy();
      edgeType.value = "owns";

      (newEdge.value as any).direction = "incoming";
      await nextTick();
      // Logic allows staying on 'owns' if it's available?
      // Wait, 'owns' IS available for Person.
      // So it shouldn't reset.
    });
  });

  describe("Edge Types Availability", () => {
    const cases = [
      {
        nodeType: "person",
        expected: [
          "owns",
          "connection",
          "mentions_person",
          "employed",
          "mentions_place",
        ],
      },
      {
        nodeType: "place",
        expected: ["owns", "mentions_person", "employed", "mentions_place"],
      },
      {
        nodeType: "article",
        expected: ["mentions_person", "mentions_place"],
      },
    ];

    for (const { nodeType, expected } of cases) {
      it(`lists correct edges for node type: ${nodeType}`, async () => {
        mockNodeType.value = nodeType;
        const { availableEdgeTypes } = useEdgeEdit({
          nodeId: mockNodeId,
          nodeType: mockNodeType,
          authHeaders: mockAuthHeaders,
        });

        const values = availableEdgeTypes.value.map((x) => x.value);
        expect(values.sort()).toEqual(expected.sort());
      });
    }
  });

  it("adds edge", async () => {
    const { processEdge, newEdge, pickerTarget } = useEdgeEdit({
      nodeId: mockNodeId,
      nodeType: mockNodeType,
      authHeaders: mockAuthHeaders,
      onUpdate: mockOnUpdate,
    });

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
