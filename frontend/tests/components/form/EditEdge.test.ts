import { describe, it, expect, vi } from "vitest";
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

// Mock useNodeEdit
const mockProcessEdge = vi.fn();
const mockCancelEditEdge = vi.fn();
const mockNewEdge = ref({
  direction: "outgoing",
  type: "connection",
  id: undefined,
});
const mockEdgeType = ref("connection");
const mockAvailableEdgeTypes = ref([
  { value: "connection", label: "Connection" },
  { value: "owns", label: "Owner" },
]);
const mockPickerTarget = ref(null);
const mockIsEditingEdge = ref(false);

const mockCurrent = ref({ name: "Current Node", type: "person" });

vi.mock("~/composables/useNodeEdit", () => ({
  useNodeEdit: async () => ({
    current: mockCurrent,
    newEdge: mockNewEdge,
    pickerTarget: mockPickerTarget,
    processEdge: mockProcessEdge,
    cancelEditEdge: mockCancelEditEdge,
    isEditingEdge: mockIsEditingEdge,
    edgeTargetType: ref("person"),
    edgeType: mockEdgeType,
    availableEdgeTypes: mockAvailableEdgeTypes,
    node_id: ref("test-node-id"),
    authHeaders: ref({}),
    refreshEdges: vi.fn(),
    stateKey: ref("test-key"),
  }),
}));

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    user: ref(null),
    authFetch: vi.fn(() => ({ data: ref({}), refresh: vi.fn() })),
  })),
}));

vi.stubGlobal("definePageMeta", vi.fn());

const EditEdgeWrapper = defineComponent({
  render() {
    return h(Suspense, null, {
      default: () => h(EditEdge),
      fallback: () => h("div", "fallback"),
    });
  },
});

vi.stubGlobal("useEdgeEdit", () => ({
  newEdge: mockNewEdge,
  processEdge: mockProcessEdge,
  cancelEditEdge: mockCancelEditEdge,
  isEditingEdge: mockIsEditingEdge,
  edgeTargetType: ref("person"),
  edgeSourceType: ref("article"),
  edgeType: mockEdgeType,
  availableEdgeTypes: mockAvailableEdgeTypes,
  pickerTarget: mockPickerTarget,
  pickerSource: ref(null),
}));

describe("EditEdge.vue", () => {
  it("renders Person buttons initially and form after click", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity", "density", "hide-details", "label"],
          },
        },
      },
    });

    await flushPromises();
    // Expect buttons not form
    expect(wrapper.text()).toContain("Dodaj nowe powiązanie");
    expect(wrapper.find("form").exists()).toBe(false);

    const buttons = wrapper.findAll(".v-btn");
    // Verify Person buttons
    expect(
      buttons.some((b) => b.text().includes("wspominający Current Node")),
    ).toBe(true);
    expect(buttons.some((b) => b.text().includes("pracuje"))).toBe(true);
    expect(buttons.some((b) => b.text().includes("zna"))).toBe(true);

    const addAcquaintanceBtn = buttons.find((b) => b.text().includes("zna"));
    await addAcquaintanceBtn?.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find("form").exists()).toBe(true);
  });

  it("renders Place buttons when node type is place", async () => {
    mockCurrent.value.type = "place";
    mockIsEditingEdge.value = false;

    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity", "density", "hide-details", "label"],
          },
        },
      },
    });

    await flushPromises();

    const buttons = wrapper.findAll(".v-btn");
    expect(buttons.some((b) => b.text().includes("firmę córkę"))).toBe(true);
    expect(buttons.some((b) => b.text().includes("firmę matkę"))).toBe(true);
    expect(
      buttons.some((b) => b.text().includes("wspominający Current Node")),
    ).toBe(true);
  });

  it("renders Article buttons when node type is article", async () => {
    mockCurrent.value.type = "article";
    mockIsEditingEdge.value = false;

    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity", "density", "hide-details", "label"],
          },
        },
      },
    });

    await flushPromises();

    const buttons = wrapper.findAll(".v-btn");
    expect(buttons.some((b) => b.text().includes("Wspomniana osoba"))).toBe(
      true,
    );
    expect(buttons.some((b) => b.text().includes("Wspomniane miejsce"))).toBe(
      true,
    );
  });

  it("submits the form", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity", "density", "hide-details", "label"],
          },
        },
      },
    });
    await flushPromises();

    // Enter form mode
    const buttons = wrapper.findAll(".v-btn");
    await buttons[0].trigger("click");
    await wrapper.vm.$nextTick();

    // Enable button by ensuring pickerTarget is set?
    // The button has :disabled="!pickerTarget"
    mockPickerTarget.value = { id: "target1" };
    await wrapper.vm.$nextTick();

    const form = wrapper.find("form");
    await form.trigger("submit");

    // expect(mockProcessEdge).toHaveBeenCalled(); TODO
  });
});
