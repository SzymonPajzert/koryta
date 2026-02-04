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
  props: ["edgeTypeExt", "editedEdge"],
  render() {
    return h(Suspense, null, {
      default: () =>
        h(EditEdge, {
          nodeId: "node-1",
          nodeType: "person",
          nodeName: "Test Node",
          authHeaders: {},
          edgeTypeExt: this.edgeTypeExt || "connection",
          editedEdge: this.editedEdge,
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
          FormEdgeSourceTarget: true,
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
          FormEdgeSourceTarget: true,
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
          FormEdgeSourceTarget: true,
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
          FormEdgeSourceTarget: true,
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
          FormEdgeSourceTarget: true,
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
});
