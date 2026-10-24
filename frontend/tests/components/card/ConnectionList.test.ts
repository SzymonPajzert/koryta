import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import ConnectionList from "../../../app/components/card/ConnectionList.vue";
import type { EdgeNode } from "../../../app/composables/edges";

enableAutoUnmount(afterEach);

/** A subsidiary of the page's company, holding `people` people. */
function subsidiary(index: number, people = 0): EdgeNode {
  return {
    id: `own-${index}`,
    type: "owns",
    label: "owns",
    source: "orlen",
    target: `c${index}`,
    visibility: true,
    richNode: {
      id: `c${index}`,
      type: "place",
      name: `Spółka ${String(index).padStart(2, "0")}`,
      stats: { people },
    },
  } as unknown as EdgeNode;
}

const subsidiaries = (count: number) =>
  Array.from({ length: count }, (_, i) => subsidiary(i));

const SPOLKI = ["spółka", "spółki", "spółek"] as const;

function mountList(props: Record<string, unknown> = {}, attach = false) {
  return mountSuspended(ConnectionList, {
    props: {
      title: "Spółki zależne",
      edges: subsidiaries(3),
      addTestid: "subsidiaries",
      ...props,
    },
    ...(attach ? { attachTo: document.body } : {}),
  });
}

type Wrapper = Awaited<ReturnType<typeof mountList>>;

const rows = (wrapper: Wrapper) => wrapper.findAll(".v-list-item");

/** A row's title as a browser sets it, where a run of spaces is one. */
const title = (row: ReturnType<typeof rows>[number]) =>
  row.get(".v-list-item-title").text().replace(/\s+/g, " ");

/** A company's owners and subsidiaries, and a region's institutions. */
describe("CardConnectionList", () => {
  it("counts its rows beside the head, in the page's noun", async () => {
    const caption = async (count: number, nouns = SPOLKI) =>
      (await mountList({ edges: subsidiaries(count), countNouns: nouns }))
        .get(".sec-head__caption")
        .text();

    expect(await caption(1)).toBe("1 spółka");
    expect(await caption(3)).toBe("3 spółki");
    expect(await caption(12)).toBe("12 spółek");
    expect(await caption(22)).toBe("22 spółki");
    expect(
      await caption(1, ["podmiot", "podmioty", "podmiotów"] as never),
    ).toBe("1 podmiot");
  });

  it("has no caption without a noun, nor over an empty list", async () => {
    expect((await mountList()).find(".sec-head__caption").exists()).toBe(false);

    // There the head and its „Dodaj” are the whole section.
    const empty = await mountList({
      edges: [],
      canAdd: true,
      countNouns: SPOLKI,
    });
    expect(empty.find(".sec-head__caption").exists()).toBe(false);
  });

  it("renders nothing with no rows and no way to add one", async () => {
    const wrapper = await mountList({ edges: [] });

    expect(wrapper.find("section").exists()).toBe(false);
    expect(wrapper.text()).toBe("");
  });

  it("lists the institutions holding the most people first", async () => {
    const wrapper = await mountList({
      edges: [subsidiary(1, 4), subsidiary(2, 40), subsidiary(3)],
    });

    expect(rows(wrapper).map(title)).toEqual([
      "Spółka 02 (40)",
      "Spółka 01 (4)",
      "Spółka 03",
    ]);
  });

  describe("a long list", () => {
    // Orlen lists about eighty subsidiaries (Szymon, 2026-10-23).
    it("folds after the rows it was asked for, behind „Pokaż wszystkie”", async () => {
      const wrapper = await mountList({
        edges: [...subsidiaries(13), subsidiary(13, 900)],
        foldAfter: 12,
      });

      expect(rows(wrapper)).toHaveLength(12);
      // A fold keeps the ones holding the most people.
      expect(title(rows(wrapper)[0]!)).toBe("Spółka 13 (900)");
      const more = wrapper.get("[data-testid='connections-more-subsidiaries']");
      expect(more.text()).toBe("Pokaż wszystkie (14)");
      expect(more.attributes("aria-expanded")).toBe("false");
      expect(more.attributes("aria-controls")).toBe(
        wrapper.get(".v-list").attributes("id"),
      );
    });

    it("never folds to hide a single row", async () => {
      // The button takes about the room that row would have.
      const wrapper = await mountList({
        edges: subsidiaries(13),
        foldAfter: 12,
      });

      expect(rows(wrapper)).toHaveLength(13);
      expect(
        wrapper.find("[data-testid='connections-more-subsidiaries']").exists(),
      ).toBe(false);
    });

    it("shows every row where the page asks for no fold", async () => {
      // Signed in, the list is whole: an admin's rows carry controls nothing
      // may put a click away.
      const wrapper = await mountList({
        edges: subsidiaries(40),
        canRemove: true,
      });

      expect(rows(wrapper)).toHaveLength(40);
      expect(wrapper.find("[data-testid^='connections-more-']").exists()).toBe(
        false,
      );
    });

    it("opens the rest in place, lets the button go and hands focus to the first row it opened", async () => {
      const wrapper = await mountList(
        { edges: subsidiaries(14), foldAfter: 12 },
        true,
      );

      await wrapper
        .get("[data-testid='connections-more-subsidiaries']")
        .trigger("click");
      await flushPromises();

      expect(rows(wrapper)).toHaveLength(14);
      expect(
        wrapper.find("[data-testid='connections-more-subsidiaries']").exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain("Pokaż mniej");
      expect(document.activeElement).toBe(rows(wrapper)[12]!.element);
    });
  });

  describe("an editor's empty list", () => {
    it("says what it lacks in the quiet line, under the head and its „Dodaj”", async () => {
      // So the head does not stand bare over the next section's head
      // (Szymon, 2026-10-24).
      const wrapper = await mountList({
        edges: [],
        canAdd: true,
        emptyText: "Nie znamy spółek zależnych.",
      });

      const empty = wrapper.get("[data-testid='connections-empty']");
      expect(empty.text()).toBe("Nie znamy spółek zależnych.");
      expect(empty.classes()).toEqual(["k-note", "k-absent"]);
      expect(wrapper.get("h2").text()).toBe("Spółki zależne");
      expect(wrapper.find(".v-list").exists()).toBe(false);
    });

    it("leaves the head and its „Dodaj” alone where the page gives no line", async () => {
      const wrapper = await mountList({ edges: [], canAdd: true });

      expect(wrapper.find("[data-testid='connections-empty']").exists()).toBe(
        false,
      );
      expect(
        wrapper.find("[data-testid='add-relation-subsidiaries']").exists(),
      ).toBe(true);
    });

    it("says nothing of the kind over a list that has rows", async () => {
      const wrapper = await mountList({
        canAdd: true,
        emptyText: "Nie znamy spółek zależnych.",
      });

      expect(wrapper.find("[data-testid='connections-empty']").exists()).toBe(
        false,
      );
    });
  });

  it("offers „Dodaj” in the control tint rather than in sage", async () => {
    // Sage ink on white is 1.85:1 on this theme.
    const wrapper = await mountList({ canAdd: true });

    const add = wrapper.get("[data-testid='add-relation-subsidiaries']");
    expect(add.text()).toBe("Dodaj");
    expect(add.classes()).toContain("v-btn--variant-tonal");
    expect(add.classes().some((name) => name.includes("primary"))).toBe(false);

    await add.trigger("click");
    expect(wrapper.emitted("add")).toHaveLength(1);
  });
});
