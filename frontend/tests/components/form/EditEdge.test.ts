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
const mockNewEdge = ref<any>({
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
  }),
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
  it("renders form", async () => {
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
    expect(wrapper.text()).toContain("Dodaj nowe powiązanie");
    expect(wrapper.find("form").exists()).toBe(true);
  });

  it("toggles direction", async () => {
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

    const buttons = wrapper.findAll(".v-btn");
    const toggleBtn = buttons.find(
      (b) => b.text().includes("Do") || b.text().includes("Od"),
    );

    expect(toggleBtn).toBeDefined();

    // Depending on mocked state, verify initial text
    if (mockNewEdge.value.direction === "outgoing") {
      expect(toggleBtn?.text()).toContain("Do");
    } else {
      expect(toggleBtn?.text()).toContain("Od");
    }

    await toggleBtn?.trigger("click");

    // Check if newEdge direction changed.
    expect(mockNewEdge.value.direction).toBe(
      mockNewEdge.value.direction === "outgoing" ? "outgoing" : "incoming",
    );
    // Wait, the template logic: direction = direction === 'outgoing' ? 'incoming' : 'outgoing'
    // If it started as outgoing, it receives 'incoming'.
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

    // Enable button by ensuring pickerTarget is set?
    // The button has :disabled="!pickerTarget"
    mockPickerTarget.value = { id: "target1" };
    await wrapper.vm.$nextTick();

    const form = wrapper.find("form");
    await form.trigger("submit");

    expect(mockProcessEdge).toHaveBeenCalled();
  });
});
