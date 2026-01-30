import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNodeData } from "../../app/composables/useNodeData";
import { ref, nextTick } from "vue";
import { getDoc } from "firebase/firestore";

// Mocks
const mockedFetch = vi.fn();
vi.stubGlobal("$fetch", mockedFetch);
vi.stubGlobal("useFirebaseApp", () => ({}));
vi.stubGlobal("useState", (key: string, init: () => any) => {
  return ref(init());
});

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

describe("useNodeData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockReset();
  });

  it("should include wikipedia field when fetching existing person node", async () => {
    const nodeId = ref("123");
    const isNew = ref(false);
    const authHeaders = ref({});
    const stateKey = ref("test-key");
    const idToken = ref("token");

    // Mock getDoc to return true (exists)
    (getDoc as any).mockResolvedValue({
      exists: () => true,
      data: () => ({ type: "person" }),
    });

    // Mock API response with wikipedia field
    mockedFetch.mockResolvedValueOnce({
      node: {
        name: "Test Person",
        type: "person",
        wikipedia: "https://wikipedia.org/wiki/Test",
        rejestrIo: "https://rejestr.io/test",
      },
    });
    mockedFetch.mockResolvedValueOnce({ revisions: [] }); // fetchRevisions

    const { fetchData, current } = useNodeData({
      nodeId,
      isNew,
      authHeaders,
      stateKey,
      idToken,
    });

    await fetchData();
    await nextTick();

    expect(current.value.name).toBe("Test Person");
    expect(current.value).toHaveProperty("wikipedia");
    expect(current.value.wikipedia).toBe("https://wikipedia.org/wiki/Test");
    expect(current.value.rejestrIo).toBe("https://rejestr.io/test");
  });

  it("should initialize wikipedia field for new person node", async () => {
    const nodeId = ref(undefined);
    const isNew = ref(true);
    const authHeaders = ref({});
    const stateKey = ref("test-key-new");
    const idToken = ref("token");

    const { current } = useNodeData({
      nodeId,
      isNew,
      authHeaders,
      stateKey,
      idToken,
      initialType: "person",
    });

    expect(current.value).toHaveProperty("wikipedia");
    expect(current.value.wikipedia).toBeDefined();
    expect(Object.keys(current.value)).toContain("wikipedia");
  });
});
