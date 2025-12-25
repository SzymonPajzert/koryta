import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useNodeEdit } from "../../app/composables/useNodeEdit";
import { ref, reactive, nextTick } from "vue";

// Use simplified mocks since we are injecting
const { mockedFetch, mockedUseEdges } = vi.hoisted(() => ({
  mockedFetch: vi.fn(),
  mockedUseEdges: vi.fn(),
}));

// Global Stubs (fallback for things we don't inject like router/alert)
const mockRouterPush = vi.fn();
vi.stubGlobal("useRoute", () => ({ params: {} })); // Fallback
vi.stubGlobal("useRouter", () => ({ push: mockRouterPush }));
vi.stubGlobal("alert", vi.fn());
vi.stubGlobal("$fetch", mockedFetch);
vi.stubGlobal("useFirebaseApp", () => ({}));
vi.stubGlobal("useAuthState", () => ({ idToken: ref(null) }));

vi.mock("~/composables/edges", () => ({
  useEdges: mockedUseEdges,
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(() =>
    Promise.resolve({ exists: () => true, data: () => ({ type: "person" }) }),
  ),
}));

describe("useNodeEdit", () => {
  let mockRoute: any;
  let mockIdToken: any;
  const mockEdges = {
    sources: ref([]),
    targets: ref([]),
    refresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockReset();

    mockIdToken = ref("test-token");
    mockRoute = reactive({ params: {} });

    mockedUseEdges.mockImplementation(async () => mockEdges);
    mockEdges.refresh.mockClear();
    mockRouterPush.mockClear();
  });

  it("initializes for new node", async () => {
    mockRoute.params = { id: "new" };
    const { isNew, current } = await useNodeEdit({
      route: mockRoute,
      idToken: mockIdToken,
    });
    expect(isNew.value).toBe(true);
    expect(current.value.name).toBe("");
  });

  it("fetches data for existing node", async () => {
    mockRoute.params = { id: "123" };

    mockedFetch.mockResolvedValueOnce({
      node: { name: "Test Person", type: "person" },
    });
    mockedFetch.mockResolvedValueOnce({ revisions: [] });

    const { isNew, current } = await useNodeEdit({
      route: mockRoute,
      idToken: mockIdToken,
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(isNew.value).toBe(false);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch).toHaveBeenNthCalledWith(
      1,
      "/api/nodes/entry/123",
      expect.anything(),
    );
    expect(current.value.name).toBe("Test Person");
  });

  it("saves new node", async () => {
    mockRoute.params = { id: "new" };
    const { saveNode, current } = await useNodeEdit({
      route: mockRoute,
      idToken: mockIdToken,
      router: { push: mockRouterPush },
    });

    current.value.name = "New Person";
    mockedFetch.mockResolvedValueOnce({ id: "new-id" });

    await saveNode();

    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/nodes/create",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ name: "New Person" }),
      }),
    );
    expect(mockRouterPush).toHaveBeenCalledWith("/edit/node/new-id");
  });

  it("saves existing node as revision", async () => {
    mockRoute.params = { id: "123" };
    mockedFetch.mockResolvedValueOnce({ node: { name: "Old Name" } });
    mockedFetch.mockResolvedValueOnce({ revisions: [] });

    const { saveNode, current } = await useNodeEdit({
      route: mockRoute,
      idToken: mockIdToken,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockedFetch.mockClear();

    current.value.name = "Updated Name";

    mockedFetch.mockResolvedValueOnce({ id: "rev-id" });
    mockedFetch.mockResolvedValueOnce({ revisions: [{ id: "rev-id" }] });

    await saveNode();

    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/revisions/create",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ name: "Updated Name", node_id: "123" }),
      }),
    );
  });
});
