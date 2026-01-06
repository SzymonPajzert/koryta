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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        edge: edge as unknown as any,
      },
    });

    const card = wrapper.findComponent({ name: "VCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("to")).toBe("/entity/person/123");
    expect(card.text()).toContain("Alice");
    expect(card.text()).toContain("Developer");
    expect(card.text()).toContain("Bio");
  });
});
