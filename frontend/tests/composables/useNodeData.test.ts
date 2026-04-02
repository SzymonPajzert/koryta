import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNodeData } from "../../app/composables/useNodeData";
import { ref, nextTick } from "vue";

// Mocks
const mockedFetch = vi.fn();
vi.stubGlobal("$fetch", mockedFetch);
vi.stubGlobal("useFirebaseApp", () => ({}));
vi.stubGlobal("useState", (key: string, init: () => any) => {
  return ref(init());
});
vi.stubGlobal("useAuthState", () => ({
  user: ref(null),
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock("~/composables/useFunctions", () => ({
  getPageTitle: vi.fn(),
}));

describe("useNodeData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockReset();
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

  it("should automatically fetch title when source URL is entered for an article", async () => {
    const { getPageTitle } = await import("~/composables/useFunctions");
    vi.mocked(getPageTitle).mockResolvedValueOnce("Test Article Title");

    const nodeId = ref(undefined);
    const isNew = ref(true);
    const authHeaders = ref({});
    const stateKey = ref("test-key-article");
    const idToken = ref("token");

    const { current } = useNodeData({
      nodeId,
      isNew,
      authHeaders,
      stateKey,
      idToken,
      initialType: "article",
    });

    // Simulate user entering a source URL
    current.value.sourceURL = "https://example.com/article";

    // Wait for watchers to trigger and promises to resolve
    await nextTick();
    // Watcher triggers async fetchPageTitleIfNeeded, so we might need another tick or flushPromises
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getPageTitle).toHaveBeenCalledWith("https://example.com/article");
    expect(current.value.name).toBe("Test Article Title");
  });
});
