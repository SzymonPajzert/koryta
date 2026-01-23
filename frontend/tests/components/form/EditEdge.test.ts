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

vi.mock("~/composables/useNodeEdit", () => ({
  useNodeEdit: async () => ({
    current: ref({ name: "Current Node", type: "person" }),
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

describe("EditEdge.vue", () => {
  it("renders buttons initially and form after click", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity"],
          },
        },
      },
    });

    await flushPromises();
    // Expect buttons not form
    expect(wrapper.text()).toContain("Dodaj nowe powiązanie");
    expect(wrapper.find("form").exists()).toBe(false);

    const buttons = wrapper.findAll(".v-btn");
    const addAcquaintanceBtn = buttons.find((b) => b.text().includes("zna"));
    expect(addAcquaintanceBtn?.exists()).toBe(true);

    await addAcquaintanceBtn?.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find("form").exists()).toBe(true);
  });

  it("submits the form", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity"],
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
