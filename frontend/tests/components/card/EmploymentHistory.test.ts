import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import EmploymentHistory from "../../../app/components/card/EmploymentHistory.vue";
import PartyChip from "../../../app/components/PartyChip.vue";
import ChipPublicCompany from "../../../app/components/chip/PublicCompany.vue";
import ChipRelativeDuration from "../../../app/components/chip/RelativeDuration.vue";
import type { EdgeNode } from "../../../app/composables/edges";

const vuetify = createVuetify({ components, directives });

function edge(fields: Partial<EdgeNode>): EdgeNode {
  return {
    id: "e1",
    type: "employed",
    label: "Zarząd",
    source: "person",
    target: "place",
    richNode: { id: "place", type: "place", name: "PKP" },
    ...fields,
  } as EdgeNode;
}

async function render(edges: EdgeNode[]) {
  return await mountSuspended(EmploymentHistory, { props: { edges } });
}

describe("CardEmploymentHistory", () => {
  it("shows the period of a dated relation", async () => {
    const wrapper = await render([
      edge({ start_date: "2014-11-06", end_date: "2017-08-25" }),
    ]);
    expect(wrapper.text()).toContain("2014-11-06 - 2017-08-25");
    // Anchors the selector the undated case asserts the absence of.
    expect(
      wrapper.findComponent({ name: "ChipRelativeDuration" }).exists(),
    ).toBe(true);
  });

  it("drops the duration bar for a relation that carries no dates", async () => {
    // `connection` has no date fields in the schema, so every one of them would
    // otherwise draw a full-width bar over a span nobody recorded.
    const wrapper = await render([
      edge({ type: "connection", label: "kolega z zarządu" }),
    ]);
    expect(wrapper.text()).toContain("kolega z zarządu");
    expect(
      wrapper.findComponent({ name: "ChipRelativeDuration" }).exists(),
    ).toBe(false);
  });

  it("never renders undefined for an undated employment", async () => {
    const wrapper = await render([edge({ label: "zastępca prezesa" })]);
    expect(wrapper.text()).not.toContain("undefined");
  });

  it("offers no removal to a reader who is not an admin", async () => {
    // Removing takes effect at once rather than joining a review queue, so the
    // control has to be absent rather than merely refused by the server.
    const wrapper = await render([edge({})]);
    expect(wrapper.find('[data-testid="edge-remove-e1"]').exists()).toBe(false);
  });

  it("asks the page to remove the row an admin clicked", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: { edges: [edge({})], canRemove: true },
    });

    await wrapper.get('[data-testid="edge-remove-e1"]').trigger("click");

    // The edge itself, not its id: the dialog names the relation being removed
    // and needs the far end and the dates to do it.
    expect(wrapper.emitted("remove")?.[0]?.[0]).toMatchObject({ id: "e1" });
  });
});

/** The one-line hint that ties a row to the "Zmiany na stanowisku" section
 * below it: who sat in this seat before. */
describe("EmploymentHistory predecessors", () => {
  const predecessor = {
    edgeId: "e-hubert",
    personId: "hubert",
    personName: "Hubert Grzegorczyk",
    parties: ["PiS"],
    start: "2021-03-01",
    end: "2024-05-16",
    published: true,
    gapDays: 0,
  };

  it("names who held the seat before, with the party and the gap", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [edge({ start_date: "2024-05-16" })],
        predecessors: { e1: predecessor },
      },
    });

    const hint = wrapper.get('[data-testid="edge-predecessor-e1"]');
    expect(hint.text()).toContain("Wcześniej:");
    expect(hint.text()).toContain("Hubert Grzegorczyk");
    expect(hint.text()).toContain("PiS");
    // `gapLabel` from shared/succession.ts, so this row and the section below
    // it cannot describe one handover two ways.
    expect(hint.text()).toContain("tego samego dnia");
  });

  it("does not put a link inside the row's own link", async () => {
    // The row is an anchor to the other end of the relation. An anchor inside
    // an anchor is invalid, and the parser recovers from it by closing the
    // outer one and reopening it around every following fragment - which broke
    // one row into three separate boxes on the person page.
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [edge({ start_date: "2024-05-16" })],
        predecessors: { e1: predecessor },
      },
    });

    expect(
      wrapper.get('[data-testid="edge-predecessor-e1"]').findAll("a"),
    ).toHaveLength(0);
  });

  it("leaves a row nobody was matched to alone", async () => {
    const wrapper = await mountSuspended(EmploymentHistory, {
      props: {
        edges: [edge({ id: "e2" })],
        predecessors: { e1: predecessor },
      },
    });

    expect(wrapper.find('[data-testid="edge-predecessor-e2"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain("Wcześniej");
  });

  it("says nothing on a card that was handed no successions at all", async () => {
    const wrapper = await render([edge({})]);

    expect(wrapper.find('[data-testid="edge-predecessor-e1"]').exists()).toBe(
      false,
    );
  });
});

/** The shape `useEdges` hands the card, narrowed to what this card reads. */
function candidacy(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    type: "election",
    label: "Kandydował/a w",
    source: "person1",
    target: "teryt1261",
    start_date: "2024-01-01",
    richNode: { id: "teryt1261", type: "region", name: "Kraków" },
    ...overrides,
  };
}

function mountHistory(edges: unknown[]) {
  return mount(EmploymentHistory, {
    global: {
      plugins: [vuetify],
      components: { PartyChip, ChipPublicCompany, ChipRelativeDuration },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props: { edges: edges as any },
  });
}

describe("EmploymentHistory", () => {
  it("names the party and the committee of a candidacy", () => {
    const wrapper = mountHistory([
      candidacy({
        party: "PiS",
        committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
      }),
    ]);

    expect(wrapper.text()).toContain("Kraków");
    expect(wrapper.text()).toContain("PiS");
    expect(wrapper.text()).toContain("Komitet Wyborczy Prawo i Sprawiedliwość");
  });

  it("names a local committee that maps onto no party", () => {
    const wrapper = mountHistory([
      candidacy({ committee: "Komitet Wyborczy Wyborców Wspólny Kalisz" }),
    ]);

    expect(wrapper.text()).toContain(
      "Komitet Wyborczy Wyborców Wspólny Kalisz",
    );
    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });

  it("does not repeat a committee that is spelled like its party", () => {
    const wrapper = mountHistory([
      candidacy({ party: "PSL", committee: "psl" }),
    ]);

    expect(wrapper.findComponent(PartyChip).exists()).toBe(true);
    expect(wrapper.text()).not.toContain("psl");
  });

  it("leaves a candidacy with neither field as it was", () => {
    const wrapper = mountHistory([candidacy()]);

    expect(wrapper.text()).toContain("Kandydował/a w");
    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });

  it("shows no party chip for an employment that carries one", () => {
    const wrapper = mountHistory([
      candidacy({ type: "employed", label: "Prezes", party: "PiS" }),
    ]);

    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });
});

/** The per-row citation button: how many articles a claim rests on, and the way
 * into changing that. */
describe("EmploymentHistory sources", () => {
  function sourcesButton(wrapper: ReturnType<typeof mountHistory>) {
    return wrapper.find('[data-testid="edge-sources-open-e1"]');
  }

  it("counts the articles a relation is cited to", () => {
    const wrapper = mountHistory([
      candidacy({ references: ["a1", "a2"], label: "Prezes" }),
    ]);

    expect(sourcesButton(wrapper).text()).toContain("2");
  });

  it("offers an editor a way in on a relation with no source at all", () => {
    const wrapper = mount(EmploymentHistory, {
      global: {
        plugins: [vuetify],
        components: { PartyChip, ChipPublicCompany, ChipRelativeDuration },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: { edges: [candidacy()] as any, canCite: true },
    });

    expect(sourcesButton(wrapper).exists()).toBe(true);
    expect(sourcesButton(wrapper).text()).toBe("");
  });

  it("says nothing to a reader who cannot cite anything", () => {
    // Every candidacy comes from the register with no `references`, so an
    // anonymous reader would otherwise get a row of dead buttons down the page.
    const wrapper = mountHistory([candidacy()]);

    expect(sourcesButton(wrapper).exists()).toBe(false);
  });

  it("asks for the sources rather than following the row's link", async () => {
    const wrapper = mountHistory([candidacy({ references: ["a1"] })]);

    await sourcesButton(wrapper).trigger("click");

    expect(wrapper.emitted("sources")?.[0]?.[0]).toMatchObject({ id: "e1" });
  });
});
