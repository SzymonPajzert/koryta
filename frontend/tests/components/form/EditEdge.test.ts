import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import EditEdge from "../../../app/components/form/EditEdge.vue";
import { defineComponent, h, Suspense, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

// Mocks
const mockProcessEdge = vi.fn();
const mockOpenEditEdge = vi.fn();
const mockNewEdge = ref({
  direction: "outgoing",
  type: "connection",
  id: undefined,
});
const mockLayout = {
  source: { id: ref("node-1"), type: ref("person"), ref: ref(undefined) },
  target: { id: ref(undefined), type: ref("person"), ref: ref(undefined) },
};
const mockReadyToSubmit = ref(false);

vi.mock("~/composables/useEdgeEdit", () => ({
  useEdgeEdit: vi.fn(() => ({
    newEdge: mockNewEdge,
    processEdge: mockProcessEdge,
    openEditEdge: mockOpenEditEdge,
    edgeType: ref("connection"),
    edgeLabel: ref("Powiązanie"),
    layout: mockLayout,
    readyToSubmit: mockReadyToSubmit,
  })),
}));

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    user: ref({}),
    authHeaders: ref({ Authorization: "Bearer test" }),
  })),
}));

const EditEdgeWrapper = defineComponent({
  props: ["edgeTypeExt", "editedEdge", "initialDirection"],
  render() {
    return h(Suspense, null, {
      default: () =>
        h(EditEdge, {
          nodeId: "node-1",
          nodeType: "person",
          nodeName: "Test Node",
          edgeTypeExt: this.edgeTypeExt || "connection",
          editedEdge: this.editedEdge,
          initialDirection: this.initialDirection,
        }),
      fallback: () => h("div", "fallback"),
    });
  },
});

describe("EditEdge.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadyToSubmit.value = false;
  });

  it("renders the form for a new edge", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "connection" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            name: "FormEdgeSourceTarget",
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find("form").exists()).toBe(true);
    expect(wrapper.text()).toContain("Dodaj powiązanie");
    expect(wrapper.find('[data-testid="submit-edge-button"]').exists()).toBe(
      true,
    );
  });

  it("renders the form for editing an existing edge", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "connection", editedEdge: "edge-123" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            name: "FormEdgeSourceTarget",
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("Zapisz zmiany");
    expect(
      wrapper.findComponent({ name: "DialogProposeRemoval" }).exists(),
    ).toBe(true);
  });

  it("disables submit button when not ready", async () => {
    mockReadyToSubmit.value = false;
    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "connection" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            name: "FormEdgeSourceTarget",
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();
    const btn = wrapper.find('[data-testid="submit-edge-button"]');
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("enables submit button and calls processEdge on submit", async () => {
    mockReadyToSubmit.value = true;
    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "connection" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            name: "FormEdgeSourceTarget",
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();
    const btn = wrapper.find('[data-testid="submit-edge-button"]');
    expect(btn.attributes("disabled")).toBeUndefined();

    await wrapper.find("form").trigger("submit");
    expect(mockProcessEdge).toHaveBeenCalled();
  });

  it("emits update on cancel", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "connection", editedEdge: "edge-123" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            name: "FormEdgeSourceTarget",
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();
    const cancelBtn = wrapper
      .findAll(".v-btn")
      .find((b) => b.text().includes("Anuluj"));
    await cancelBtn!.trigger("click");

    expect(wrapper.findComponent(EditEdge).emitted("update")).toBeTruthy();
  });

  it("passes initialDirection to useEdgeEdit", async () => {
    mount(EditEdgeWrapper, {
      props: {
        edgeTypeExt: "employed",
        initialDirection: "incoming", // prop on the wrapper (if we update wrapper props)
      },
      attrs: {
        // Pass to component directly if wrapper doesn't expose it
        initialDirection: "incoming",
      },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            name: "FormEdgeSourceTarget",
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();

    expect(useEdgeEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        initialDirection: "incoming",
        edgeType: "employed",
      }),
    );
  });

  it("passes correct labels to FormEdgeSourceTarget based on edgeType", async () => {
    // mock useEdgeEdit to return 'employed' to test specific labels
    // However, the global mock returns 'connection'.
    // 'connection' options: sourceLabel='Osoba 1', targetLabel='Osoba 2'

    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "connection" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            name: "FormEdgeSourceTarget",
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();

    const pickers = wrapper.findAllComponents({ name: "FormEdgeSourceTarget" });
    expect(pickers.length).toBe(2);

    expect(pickers[0].props("label")).toBe("Osoba 1");
    expect(pickers[1].props("label")).toBe("Osoba 2");
  });

  it("renders specific fields when edgeType is election", async () => {
    mockNewEdge.value = { ...mockNewEdge.value, type: "election" };
    // update mock useEdgeEdit to return 'election'
    useEdgeEdit.mockReturnValueOnce({
      newEdge: mockNewEdge,
      processEdge: mockProcessEdge,
      openEditEdge: mockOpenEditEdge,
      edgeType: ref("election"),
      edgeLabel: ref("Kandydował/a w"),
      layout: mockLayout,
      readyToSubmit: mockReadyToSubmit,
    });

    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "election" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            name: "FormEdgeSourceTarget",
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find('[data-testid="edge-party-select"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="edge-committee-field"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="edge-position-select"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="edge-term-select"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="edge-elected-checkbox"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="edge-by-election-checkbox"]').exists(),
    ).toBe(true);
  });
});
