import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConnectionList from "../../../app/components/card/ConnectionList.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import type { EdgeNode } from "../../../app/composables/edges";

const vuetify = createVuetify({ components, directives });

function edge(id: string, fields: Partial<EdgeNode> = {}): EdgeNode {
  return {
    id: `edge-${id}`,
    type: "owns",
    label: "Właściciel",
    source: id,
    target: "fundacja",
    visibility: true,
    richNode: { id, type: "place", name: `Spółka ${id}` },
    ...fields,
  } as EdgeNode;
}

function mountList(edges: EdgeNode[], founderLabel?: (e: EdgeNode) => string) {
  return mount(ConnectionList, {
    global: {
      plugins: [vuetify],
      stubs: { ChipCompanyCategories: true, ChipEdgeDraftStatus: true },
    },
    props: { title: "Właściciele", edges, founderLabel },
  });
}

describe("ConnectionList", () => {
  it("says which row is the founder's, in the word the page gives", () => {
    const wrapper = mountList(
      [edge("arp", { founder: true }), edge("gmina")],
      () => "Fundator",
    );

    const labels = wrapper.findAll('[data-testid="founder-label"]');
    expect(labels).toHaveLength(1);
    expect(labels[0]!.text()).toBe("Fundator");
    // Under the name, on the sector's line and before it - not in the name's
    // line, which a phone ends in an ellipsis.
    const line = labels[0]!.element.parentElement!;
    expect(line.firstElementChild).toBe(labels[0]!.element);
    expect(line.querySelector("chip-company-categories-stub")).not.toBeNull();
    expect(
      wrapper
        .find(".v-list-item-title")
        .find('[data-testid="founder-label"]')
        .exists(),
    ).toBe(false);
  });

  it("asks for the word row by row", () => {
    const wrapper = mountList(
      [
        edge("fundacja-x", { founder: true }),
        edge("klub-y", { founder: true }),
      ],
      (e) => (e.richNode.id === "klub-y" ? "założone" : "założona"),
    );

    const labels = wrapper
      .findAll('[data-testid="founder-label"]')
      .map((l) => l.text());
    expect(labels.sort()).toEqual(["założona", "założone"]);
  });

  it("draws a founder's row like any other where the list passes no word", () => {
    const wrapper = mountList([edge("arp", { founder: true })]);

    expect(wrapper.find('[data-testid="founder-label"]').exists()).toBe(false);
  });

  it("labels only an ownership edge", () => {
    const wrapper = mountList(
      [edge("x", { type: "seat", founder: true })],
      () => "Fundator",
    );

    expect(wrapper.find('[data-testid="founder-label"]').exists()).toBe(false);
  });
});
