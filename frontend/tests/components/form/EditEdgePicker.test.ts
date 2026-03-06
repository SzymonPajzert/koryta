import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EditEdgePicker from "../../../app/components/form/EditEdgePicker.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

describe("EditEdgePicker.vue", () => {
  it("renders Person buttons when node type is person", () => {
    const wrapper = mount(EditEdgePicker, {
      props: {
        nodeId: "test-node",
        nodeType: "person",
        nodeName: "Jan Kowalski",
      },
      global: {
        plugins: [vuetify],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("wspominający Jan Kowalski");
    expect(text).toContain("pracuje");
    expect(text).toContain("zna");
  });

  it("renders Place buttons when node type is place", () => {
    const wrapper = mount(EditEdgePicker, {
      props: {
        nodeId: "test-node",
        nodeType: "place",
        nodeName: "Firma X",
      },
      global: {
        plugins: [vuetify],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("firmę córkę");
    expect(text).toContain("firmę matkę");
    expect(text).toContain("wspominający Firma X");
  });

  it("renders Article buttons when node type is article", () => {
    const wrapper = mount(EditEdgePicker, {
      props: {
        nodeId: "test-node",
        nodeType: "article",
        nodeName: "Artykuł Y",
      },
      global: {
        plugins: [vuetify],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("Wspomniana osoba");
    expect(text).toContain("Wspomniane miejsce");
  });

  it("emits pick event when button is clicked", async () => {
    const wrapper = mount(EditEdgePicker, {
      props: {
        nodeId: "test-node",
        nodeType: "person",
        nodeName: "Jan Kowalski",
      },
      global: {
        plugins: [vuetify],
      },
    });

    const buttons = wrapper.findAll(".v-btn");
    const znaBtn = buttons.find((b) => b.text().includes("zna"));
    expect(znaBtn).toBeDefined();

    await znaBtn!.trigger("click");

    expect(wrapper.emitted("pick")).toBeTruthy();
    expect(wrapper.emitted("pick")![0]).toEqual(["connection", "outgoing"]);
  });
});
