import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import EditEdge from "~/components/form/EditEdge.vue";
import { defineComponent, h, Suspense, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    user: ref({ uid: "test-user" }),
    authHeaders: ref({ Authorization: "Bearer test-token" }),
  })),
}));

const EditEdgeWrapper = defineComponent({
  props: ["edgeTypeExt"],
  render() {
    return h(Suspense, null, {
      default: () =>
        h(EditEdge, {
          nodeId: "test-person-123",
          nodeType: "person",
          nodeName: "Test Person",
          edgeTypeExt: this.edgeTypeExt || "election",
        }),
      fallback: () => h("div", "fallback"),
    });
  },
});

describe("Election Edge Form Flow", () => {
  it("can fill election details in the EditEdge component", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "election" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();

    // Wait for the form to render
    expect(wrapper.find("form").exists()).toBe(true);

    // Check if election fields exist
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

    expect(wrapper.text()).toContain("Komitet");
    expect(wrapper.text()).toContain("Stanowisko");
  });

  it("can fill all election details and they are correctly bound", async () => {
    const wrapper = mount(EditEdgeWrapper, {
      props: { edgeTypeExt: "election" },
      global: {
        plugins: [vuetify],
        stubs: {
          EntityPicker: true,
          FormEdgeSourceTarget: {
            template: '<div class="form-edge-source-target-stub"></div>',
            props: ["nodeType", "nodeName", "label", "modelValue"],
          },
          DialogProposeRemoval: true,
        },
      },
    });

    await flushPromises();

    const committeeField = wrapper.find(
      '[data-testid="edge-committee-field"] input',
    );
    const electedCheckbox = wrapper.find(
      '[data-testid="edge-elected-checkbox"] input',
    );
    const byElectionCheckbox = wrapper.find(
      '[data-testid="edge-by-election-checkbox"] input',
    );

    await committeeField.setValue("KKW Koalicja Obywatelska");

    // Let's check if the values are reflected in the inputs
    expect((committeeField.element as HTMLInputElement).value).toBe(
      "KKW Koalicja Obywatelska",
    );

    // We can also verify that checkboxes can be checked
    await electedCheckbox.setValue(true);
    expect((electedCheckbox.element as HTMLInputElement).checked).toBe(true);

    await byElectionCheckbox.setValue(true);
    expect((byElectionCheckbox.element as HTMLInputElement).checked).toBe(true);
  });
});
