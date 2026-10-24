import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import HistoryRowActions from "../../../app/components/card/HistoryRowActions.vue";
import type { EdgeNode } from "../../../app/composables/edges";

function edge(fields: Partial<EdgeNode> = {}): EdgeNode {
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

const mountActions = (props: Record<string, unknown>) =>
  mountSuspended(HistoryRowActions, { props: { edge: edge(), ...props } });

/** The buttons at the end of a row of the relation history - and, on a
 * company's page, of a card of „Obecny skład”, which shows today's board in
 * the history's place. One copy of them is what keeps the hosts from
 * drifting. */
describe("CardHistoryRowActions", () => {
  it("counts the articles a relation is cited to, for anybody", async () => {
    const wrapper = await mountActions({
      edge: edge({ references: ["a1", "a2"] }),
    });

    const sources = wrapper.get("[data-testid='edge-sources-open-e1']");
    expect(sources.text()).toBe("2");
    expect(sources.attributes("title")).toBe("Pokaż źródła powiązania");
    expect(wrapper.findAll(".v-btn")).toHaveLength(1);
  });

  it("offers an editor a source for a relation that has none", async () => {
    const wrapper = await mountActions({ canCite: true });

    const sources = wrapper.get("[data-testid='edge-sources-open-e1']");
    expect(sources.text()).toBe("");
    expect(sources.attributes("title")).toBe("Dodaj źródło powiązania");
  });

  it("draws nothing for a reader who can do nothing with an uncited relation", async () => {
    const wrapper = await mountActions({});

    expect(wrapper.find(".v-btn").exists()).toBe(false);
    expect(wrapper.find(".row-actions__gap").exists()).toBe(false);
  });

  it("holds the sources button's room on a row that has none, when asked", async () => {
    // So a column of dates beside these buttons lines up down the list.
    const held = await mountActions({ reserveSources: true });
    expect(held.get(".row-actions__gap").attributes("aria-hidden")).toBe(
      "true",
    );

    const cited = await mountActions({
      edge: edge({ references: ["a1"] }),
      reserveSources: true,
    });
    expect(cited.find(".row-actions__gap").exists()).toBe(false);
  });

  it("orders them by what a mistake costs: cite it, fix it, remove it", async () => {
    const wrapper = await mountActions({
      canCite: true,
      canCorrect: true,
      canRemove: true,
    });

    expect(
      wrapper.findAll(".v-btn").map((button) => button.attributes("title")),
    ).toEqual([
      "Dodaj źródło powiązania",
      "Popraw powiązanie",
      "Usuń powiązanie",
    ]);
  });

  it("offers correcting to whoever may, and the bin to an admin alone", async () => {
    const contributor = await mountActions({ canCorrect: true });
    expect(contributor.find("[data-testid='edge-edit-e1']").exists()).toBe(
      true,
    );
    expect(contributor.find("[data-testid='edge-remove-e1']").exists()).toBe(
      false,
    );

    const admin = await mountActions({ canRemove: true });
    expect(admin.find("[data-testid='edge-remove-e1']").exists()).toBe(true);
    expect(admin.find("[data-testid='edge-edit-e1']").exists()).toBe(false);
  });

  it("hands the relation up and keeps the click from following the row's link", async () => {
    const row = edge({ references: ["a1"] });
    const wrapper = await mountActions({
      edge: row,
      canCorrect: true,
      canRemove: true,
    });
    let followed = 0;
    wrapper.get("div").element.addEventListener("click", () => (followed += 1));

    for (const [testid, event] of [
      ["edge-sources-open-e1", "sources"],
      ["edge-edit-e1", "edit"],
      ["edge-remove-e1", "remove"],
    ] as const) {
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      wrapper.get(`[data-testid='${testid}']`).element.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(wrapper.emitted(event)?.[0]?.[0]).toBe(row);
    }
    // The row is a link to the other end of the relation.
    expect(followed).toBe(0);
  });

  it("offers nothing for a relation that was never saved", async () => {
    const wrapper = await mountActions({
      edge: edge({ id: undefined, references: ["a1"] }),
      canCite: true,
      canCorrect: true,
      canRemove: true,
    });

    expect(wrapper.find(".v-btn").exists()).toBe(false);
  });
});
