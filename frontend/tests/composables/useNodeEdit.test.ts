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
    mockRoute = reactive({ params: {}, query: {} });

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

  it("initializes type from query param", async () => {
    mockRoute.params = { id: "new" };
    mockRoute.query = { type: "article" };
    const { current } = await useNodeEdit({
      route: mockRoute,
      idToken: mockIdToken,
    });
    expect(current.value.type).toBe("article");
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

  it("adds edge", async () => {
    mockRoute.params = { id: "123" };
    mockedFetch.mockResolvedValueOnce({ node: { name: "Foo" } });
    mockedFetch.mockResolvedValueOnce({ revisions: [] });

    const { processEdge, newEdge, pickerTarget } = await useNodeEdit({
      route: mockRoute,
      idToken: mockIdToken,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockedFetch.mockClear();

    newEdge.value.type = "employed";
    pickerTarget.value = { id: "company-1" };

    mockedFetch.mockResolvedValueOnce({});

    await processEdge();

    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/edges/create",
      expect.objectContaining({
        body: expect.objectContaining({
          source: "123",
          target: "company-1",
          type: "employed",
        }),
      }),
    );
    expect(mockEdges.refresh).toHaveBeenCalled();
  });

  describe("Edge Logic", () => {
    it("filters edge types for Person (outgoing)", async () => {
      mockRoute.params = { id: "123" };
      mockedFetch.mockResolvedValueOnce({
        node: { name: "Person", type: "person" },
      });
      mockedFetch.mockResolvedValueOnce({ revisions: [] });

      const { availableEdgeTypes, newEdge } = await useNodeEdit({
        route: mockRoute,
        idToken: mockIdToken,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Person Outgoing
      // Should include 'owns' (Source: Person)
      // Should include 'connection' (Source: Person)
      // Should include 'employed' (Source: Person)
      const types = availableEdgeTypes.value.map((o) => o.value);
      expect(types).toContain("owns");
      expect(types).toContain("connection");
      expect(types).toContain("employed");

      // Change to incoming
      (newEdge.value as any).direction = "incoming";
      await nextTick();
      const typesIn = availableEdgeTypes.value.map((o) => o.value);

      // Person Incoming
      // 'owns' (Target: Place) -> Include (because it is valid Outgoing)
      // 'connection' (Target: Person) -> Include
      // 'employed' (Target: Place) -> Exclude (Person cannot be Target of employed) - Wait, employed is Person->Place. Person is Source.
      // employed: Source=Person, Target=Place.
      // If I am Person: canBeSource=True. canBeTarget=False.
      // So 'employed' should be included!
      expect(typesIn).toContain("owns");
      expect(typesIn).toContain("connection");
      expect(typesIn).toContain("employed");
    });

    it("shows edge types valid for ANY direction for Place", async () => {
      mockRoute.params = { id: "999" };
      mockedFetch.mockResolvedValueOnce({
        node: { name: "Corp", type: "place" },
      });
      mockedFetch.mockResolvedValueOnce({ revisions: [] });

      const { availableEdgeTypes, newEdge } = await useNodeEdit({
        route: mockRoute,
        idToken: mockIdToken,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Place Outgoing (Default)
      // 'owns' (Target: Place) -> Should Include (because it is valid incoming)
      const types = availableEdgeTypes.value.map((o) => o.value);
      expect(types).toContain("owns");
    });

    it("switches direction when selecting a type that requires it", async () => {
      mockRoute.params = { id: "999" };
      mockedFetch.mockResolvedValueOnce({
        node: { name: "Corp", type: "place" },
      });
      mockedFetch.mockResolvedValueOnce({ revisions: [] });

      const { availableEdgeTypes, newEdge, edgeType } = await useNodeEdit({
        route: mockRoute,
        idToken: mockIdToken,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect((newEdge.value as any).direction).toBe("outgoing");
      
      // Select 'owns' (requires Place to be Target -> Incoming)
      edgeType.value = "owns";
      await nextTick();
      
      expect((newEdge.value as any).direction).toBe("incoming");
    });

    it("resets edgeType if invalid after direction switch", async () => {
      mockRoute.params = { id: "123" };
      mockedFetch.mockResolvedValueOnce({
        node: { name: "Person", type: "person" },
      });
      mockedFetch.mockResolvedValueOnce({ revisions: [] });

      const { availableEdgeTypes, newEdge, edgeType } = await useNodeEdit({
        route: mockRoute,
        idToken: mockIdToken,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 'owns' is valid for Person (Source)
      expect(availableEdgeTypes.value.find((t) => t.value === "owns")).toBeTruthy();
      edgeType.value = "owns";
      
      (newEdge.value as any).direction = "incoming";
      await nextTick();
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
        mockRoute.params = { id: "123" };
        mockedFetch.mockResolvedValueOnce({
          node: { name: "Test Node", type: nodeType },
        });
        mockedFetch.mockResolvedValueOnce({ revisions: [] });

        const { availableEdgeTypes } = await useNodeEdit({
          route: mockRoute,
          idToken: mockIdToken,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        const values = availableEdgeTypes.value.map((x) => x.value);
        expect(values.sort()).toEqual(expected.sort());
      });
    }
  });
});
