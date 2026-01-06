import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEdgeEdit } from "../../app/composables/useEdgeEdit";
import { ref, computed } from "vue";

// Mock useState
vi.mock("#app", () => ({
  useState: (key: string, init: () => any) => ref(init()),
}));

// Mock alert
vi.stubGlobal("alert", vi.fn());

describe("useEdgeEdit", () => {
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
