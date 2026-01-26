import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ShortNode from "../../../app/components/card/ShortNode.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({ components, directives });

describe("ShortNode", () => {
  const edge = {
    richNode: {
      id: "123",
      type: "person",
      name: "Alice",
      content: "Bio",
    },
    label: "Developer",
  };

  it("renders correctly and passes 'to' prop", () => {
    const wrapper = mount(ShortNode, {
      global: { plugins: [vuetify] },
      props: {
        edge,
      },
    });

    const card = wrapper.findComponent({ name: "VCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("to")).toBe("/entity/person/123");
    expect(card.text()).toContain("Alice");
    expect(card.text()).toContain("Developer");
    expect(card.text()).toContain("Bio");
  });

  it("applies green background if currently employed", () => {
    const currentEdge = {
      ...edge,
      start_date: "2023-01-01",
      end_date: null,
    };
    const wrapper = mount(ShortNode, {
      global: { plugins: [vuetify] },
      props: {
        edge: currentEdge,
      },
    });

    const card = wrapper.findComponent({ name: "VCard" });
    expect(card.classes()).toContain("bg-green-lighten-5");
  });

  it("does not apply green background if past employment (has end_date)", () => {
    const pastEdge = {
      ...edge,
      start_date: "2023-01-01",
      end_date: "2023-06-01",
    };
    const wrapper = mount(ShortNode, {
      global: { plugins: [vuetify] },
      props: {
        edge: pastEdge,
      },
    });

    const card = wrapper.findComponent({ name: "VCard" });
    expect(card.classes()).not.toContain("bg-green-lighten-5");
  });

  it("does not apply green background if start_date is missing (even if no end_date)", () => {
    const vagueEdge = {
      ...edge,
      start_date: null,
      end_date: null,
    };
    const wrapper = mount(ShortNode, {
      global: { plugins: [vuetify] },
      props: {
        edge: vagueEdge,
      },
    });

    const card = wrapper.findComponent({ name: "VCard" });
    expect(card.classes()).not.toContain("bg-green-lighten-5");
  });
});
