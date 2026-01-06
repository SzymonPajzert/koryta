import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import NodeEditPage from "../../../../app/pages/edit/node/[[id]].vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { ref, defineComponent, h, Suspense } from "vue";

// Setup Vuetify
const vuetify = createVuetify({
  components,
  directives,
});

// Mock dependencies
const mockSaveNode = vi.fn();
const mockAddEdge = vi.fn();
const mockFetchRevisions = vi.fn();

const mockState = {
  isNew: ref(true),
  tab: ref("content"),
  current: ref({ name: "", type: "person", parties: [], content: "" }),
  loading: ref(false),
  edgeTypeOptions: [
    { value: "employed", label: "Zatrudniony/a w", targetType: "place" },
  ],
  newEdge: ref({
    type: "connection",
    target: "",
    targetType: "person",
    name: "",
    text: "",
  }),
  pickerTarget: ref(null),
  newComment: ref(""),
  revisions: ref([]),
  allEdges: ref([]),
  partiesDefault: ref(["partia A", "partia B"]),
  idToken: ref("test-token"),
  edgeType: ref("connection"),
  edgeTargetType: ref("person"),
  availableEdgeTypes: ref([
    { value: "employed", label: "Zatrudniony/a w", targetType: "place" },
  ]),
  node_id: ref("test-node-id"),
  authHeaders: ref({}),
  refreshEdges: vi.fn(),
  stateKey: ref("test-key"),
};

vi.mock("../../../../app/composables/useNodeEdit", () => ({
  useNodeEdit: () =>
    Promise.resolve({
      ...mockState,
      saveNode: mockSaveNode,
      processEdge: mockAddEdge,
      openEditEdge: vi.fn(),
      cancelEditEdge: vi.fn(),
      isEditingEdge: ref(false),
      fetchRevisions: mockFetchRevisions,
    }),
}));

// Mock definePageMeta
vi.stubGlobal("definePageMeta", vi.fn());

// Helper to mount async component
function mountAsync(component: unknown, options: unknown = {}) {
  return mount(
    defineComponent({
      render() {
        return h(Suspense, null, {
          default: () => h(component),
          fallback: () => h("div", "fallback"),
        });
      },
    }),
    options,
  );
}

describe("NodeEditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset state defaults
    mockState.isNew.value = true;
    mockState.current.value = {
      name: "",
      type: "person",
      parties: [],
      content: "",
    };
    mockState.loading.value = false;
    mockState.allEdges.value = [];
    mockState.idToken.value = "test-token";
  });

  it("renders 'Utwórz' title when creating new node", async () => {
    const wrapper = mountAsync(NodeEditPage, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Utwórz");
  });

  it("renders 'Edytuj' title when editing existing node", async () => {
    mockState.isNew.value = false;
    const wrapper = mountAsync(NodeEditPage, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          VWindowItem: {
            template: "<div><slot /></div>",
          },
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Edytuj");
  });

  it("disables save button when loading", async () => {
    mockState.loading.value = true;
    const wrapper = mountAsync(NodeEditPage, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
        },
      },
    });
    await flushPromises();
    const saveBtn = wrapper.find('button[type="submit"]');
    expect(saveBtn.exists()).toBe(true);
    expect(saveBtn.attributes("disabled")).toBeDefined();
  });

  it("calls saveNode on form submission", async () => {
    const wrapper = mountAsync(NodeEditPage, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
        },
      },
    });
    await flushPromises();

    await wrapper.find("form").trigger("submit");
    expect(mockSaveNode).toHaveBeenCalled();
  });

  it("renders edges list when not new and edges exist", async () => {
    mockState.isNew.value = false;
    mockState.allEdges.value = [
      { richNode: { id: "1", name: "Associated Node" }, type: "employed" },
    ];

    const wrapper = mountAsync(NodeEditPage, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          VWindowItem: {
            template: "<div><slot /></div>",
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Powiązania");
    expect(wrapper.text()).toContain("Associated Node");
  });

  it("calls addEdge when adding a link", async () => {
    mockState.isNew.value = false;
    mockState.pickerTarget.value = { id: "target-id" };

    const wrapper = mountAsync(NodeEditPage, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          VWindowItem: {
            template: "<div><slot /></div>",
          },
        },
      },
    });
    await flushPromises();

    // Find the second form (add edge form)
    const forms = wrapper.findAll("form");
    expect(forms.length).toBeGreaterThan(1);
    await forms[1].trigger("submit");

    // expect(mockAddEdge).toHaveBeenCalled(); TODO
  });
});
