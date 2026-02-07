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

const mocks = vi.hoisted(() => ({
  useEdgeEdit: vi.fn(),
  useNodeEdit: vi.fn(),
}));

vi.mock("~/composables/useEdgeEdit", () => ({
  useEdgeEdit: mocks.useEdgeEdit,
}));

// Also mock relative path just in case
vi.mock("../../../app/composables/useEdgeEdit", () => ({
  useEdgeEdit: mocks.useEdgeEdit,
}));

vi.mock("~/composables/useNodeEdit", () => ({
  useNodeEdit: mocks.useNodeEdit,
}));

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    user: ref(null),
    authFetch: vi.fn(() => ({ data: ref({}), refresh: vi.fn() })),
  })),
}));

vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal(
  "useRoute",
  vi.fn(() => ({ query: {} })),
);

const EditEdgeWrapper = defineComponent({
  render() {
    return h(Suspense, null, {
      default: () => h(EditEdge),
      fallback: () => h("div", "fallback"),
    });
  },
});

// Setup mock return values
const mockNewEdge = ref({
  direction: "outgoing",
  type: "employed",
  start_date: "",
  end_date: "",
  id: undefined,
});
const mockEdgeType = ref("employed");
const mockAvailableEdgeTypes = ref([{ value: "employed", label: "Employed" }]);
const mockPickerTarget = ref({ id: "target1", type: "place" });
const mockPickerSource = ref(null);
const mockIsEditingEdge = ref(false);

mocks.useEdgeEdit.mockReturnValue({
  newEdge: mockNewEdge,
  processEdge: vi.fn(),
  cancelEditEdge: vi.fn(),
  isEditingEdge: mockIsEditingEdge,
  edgeTargetType: ref("place"),
  edgeSourceType: ref("person"),
  edgeType: mockEdgeType,
  availableEdgeTypes: mockAvailableEdgeTypes,
  pickerTarget: mockPickerTarget,
  pickerSource: mockPickerSource,
});

mocks.useNodeEdit.mockResolvedValue({
  current: ref({ name: "Current Node", type: "person" }),
  newEdge: mockNewEdge,
  pickerTarget: mockPickerTarget,
  processEdge: vi.fn(),
  cancelEditEdge: vi.fn(),
  isEditingEdge: mockIsEditingEdge,
  edgeTargetType: ref("place"),
  edgeType: mockEdgeType,
  availableEdgeTypes: mockAvailableEdgeTypes,
  node_id: ref("test-node-id"),
  authHeaders: ref({}),
  refreshEdges: vi.fn(),
  stateKey: ref("test-key"),
});

describe("EditEdge Date Format", () => {
  it("renders text inputs with RRRR-MM-DD placeholder when type is employed", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity"],
          },
          VTextField: {
            template:
              '<input class="v-text-field-stub" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ["placeholder", "modelValue"],
          },
        },
      },
    });

    await flushPromises();

    // Enter form mode via Employed button
    const buttons = wrapper.findAll(".v-btn");
    const employedBtn = buttons.find((b) => b.text().includes("pracuje"));
    await employedBtn?.trigger("click");
    await wrapper.vm.$nextTick();

    // Use the stubbed class
    const dateInputs = wrapper
      .findAll("input.v-text-field-stub")
      .filter((input) => input.attributes("placeholder") === "RRRR-MM-DD");
    expect(dateInputs.length).toBe(2);
  });

  it("binds start_date correctly", async () => {
    mockNewEdge.value.start_date = "2024-01-31";

    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity"],
          },
          VTextField: {
            template:
              '<input class="v-text-field-stub" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ["placeholder", "modelValue"],
          },
        },
      },
    });

    await flushPromises();

    // Enter form mode via Employed button
    const buttons = wrapper.findAll(".v-btn");
    const employedBtn = buttons.find((b) => b.text().includes("pracuje"));
    await employedBtn?.trigger("click");
    await wrapper.vm.$nextTick();

    const startInput = wrapper
      .findAll("input.v-text-field-stub")
      .find((input) => input.attributes("placeholder") === "RRRR-MM-DD");
    expect(startInput?.element.value).toBe("2024-01-31");
  });

  it("accepts text input", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: {
            template: '<div class="entity-picker-stub"></div>',
            props: ["modelValue", "entity"],
          },
          VTextField: {
            template:
              '<input class="v-text-field-stub" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ["placeholder", "modelValue"],
          },
        },
      },
    });
    await flushPromises();

    // Enter form mode via Employed button
    const buttons = wrapper.findAll(".v-btn");
    const employedBtn = buttons.find((b) => b.text().includes("pracuje"));
    await employedBtn?.trigger("click");
    await wrapper.vm.$nextTick();

    const startInput = wrapper
      .findAll("input.v-text-field-stub")
      .find((input) => input.attributes("placeholder") === "RRRR-MM-DD");

    if (startInput) {
      await startInput.setValue("2026-05-20");
      expect(mockNewEdge.value.start_date).toBe("2026-05-20");
    } else {
      throw new Error("Start input not found");
    }
  });
});
