import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AlreadyExisting from "../../../app/components/form/AlreadyExisting.vue";
import { defineComponent, h, Suspense, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

vi.mock("~/composables/entity", () => ({
  useEntity: async () => ({
    entities: ref({
      "1": { name: "Similar Name", type: "company" },
      "2": { name: "Different", type: "company" },
    }),
  }),
}));

const AlreadyExistingWrapper = defineComponent({
  props: ["modelValue", "entity", "create"],
  emits: ["update:modelValue"],
  setup(props, { attrs }) {
    return () =>
      h(Suspense, null, {
        default: () => h(AlreadyExisting, { ...attrs, ...props }),
        fallback: () => h("div", "fallback"),
      });
  },
});

describe("AlreadyExisting.vue", () => {
  it("shows suggestions and allows closing them", async () => {
    const wrapper = mount(AlreadyExistingWrapper, {
      props: {
        modelValue: "Similar",
        entity: "company",
        create: true,
      },
      global: {
        plugins: [vuetify],
      },
    });

    await flushPromises();

    // Check if suggestions are shown
    expect(wrapper.text()).toContain("Similar Name");
    expect(wrapper.text()).toContain("Podobne wpisy");

    // Find close button
    const closeBtn = wrapper.findComponent({ name: "VBtn" });
    expect(closeBtn.exists()).toBe(true);

    // Click close
    await closeBtn.trigger("click");

    // Check if suggestions are hidden
    expect(wrapper.text()).not.toContain("Similar Name");
    expect(wrapper.text()).not.toContain("Podobne wpisy");

    // Update model to trigger watcher
    await wrapper.setProps({ modelValue: "Similar N" });
    await wrapper.vm.$nextTick();

    // Suggestions should reappear
    expect(wrapper.text()).toContain("Similar Name");
  });
});
