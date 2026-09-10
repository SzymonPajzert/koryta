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

  it("links straight at the node's own page, not the /entity/ redirect", () => {
    const wrapper = mount(ShortNode, {
      global: { plugins: [vuetify] },
      props: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        edge: edge as unknown as any,
      },
    });

    const card = wrapper.findComponent({ name: "VCard" });
    expect(card.exists()).toBe(true);
    // The url `_sitemap-urls` advertises, so a crawler following this link
    // lands on the page rather than on a 302 to it.
    expect(card.props("to")).toBe("/osoba/alice-123");
    expect(card.text()).toContain("Alice");
    expect(card.text()).toContain("Developer");
    expect(card.text()).toContain("Bio");
  });
  it("falls back to /entity/ for a type with no page of its own", () => {
    const wrapper = mount(ShortNode, {
      global: { plugins: [vuetify] },
      props: {
        edge: {
          ...edge,
          richNode: { ...edge.richNode, type: "gadget" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as unknown as any,
      },
    });

    const card = wrapper.findComponent({ name: "VCard" });
    expect(card.props("to")).toBe("/entity/gadget/123");
  });
});
