import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import SectionHead from "../../../app/components/admin/SectionHead.vue";

// `mountSuspended`, unlike PageHead's test: this head reaches its bubble
// through Nuxt's component auto-import, so it is mounted the way the pages
// mount it.
const mountHead = (
  props: Record<string, unknown> = { title: "Otwarte" },
  slots: Record<string, string> = {},
) => mountSuspended(SectionHead, { props, slots });

/** A non-breaking space, spelled out so the expectations can be read. */
const NB = " ";

/** The heading over one section of an admin list - the queue on
 * /admin/opinie, the kinds on /admin/procesy, the groups on /admin/rewizje. */
describe("AdminSectionHead", () => {
  it("is an h2 holding the title, with nothing beside it unless given", async () => {
    const wrapper = await mountHead({ title: "Otwarte" });

    expect(wrapper.get("h2").text()).toBe("Otwarte");
    expect(wrapper.find("[data-section-count]").exists()).toBe(false);
    expect(wrapper.find("[data-testid='section-info']").exists()).toBe(false);
    // An empty actions box would still take `margin-inline-start: auto` and
    // its gap in the row.
    expect(wrapper.find(".asec__actions").exists()).toBe(false);
  });

  // „19 060”, not „19060” - grouped as the rest of the site groups numbers,
  // and with a non-breaking space so a phone never ends a line inside one.
  it("groups a count the Polish way", async () => {
    const wrapper = await mountHead({ title: "Zamknięte", count: 19060 });

    const count = wrapper.get("[data-section-count]");
    expect(count.text()).toBe(`19${NB}060`);
    // Beside the title, not inside it: the heading's name is the title alone.
    expect(wrapper.get("h2").text()).toBe("Zamknięte");
  });

  // Polish does not group a four-digit number („1234”, not „1 234”), and
  // `toLocaleString("pl-PL")` follows that. Pinned so a hand-rolled
  // replacement does not start putting a space in them.
  it("leaves a four-digit count whole", async () => {
    const wrapper = await mountHead({ title: "Zamknięte", count: 1234 });
    expect(wrapper.get("[data-section-count]").text()).toBe("1234");
  });

  // An empty section still says so, rather than losing its count to a
  // truthiness check.
  it("shows a count of zero", async () => {
    const wrapper = await mountHead({ title: "W kolejce", count: 0 });
    expect(wrapper.get("[data-section-count]").text()).toBe("0");
  });

  // A list cut off at its page size knows only a floor.
  it("prints a string count as given", async () => {
    const wrapper = await mountHead({ title: "Zamknięte", count: "16+" });
    expect(wrapper.get("[data-section-count]").text()).toBe("16+");
  });

  it("explains the section in a bubble, from the prop", async () => {
    const wrapper = await mountHead({
      title: "Na żądanie",
      info: "Jedno uruchomienie na każde żądanie.",
    });

    const bubble = wrapper.get("[data-testid='section-info']");
    expect(bubble.attributes("aria-label")).toBe("Co to jest: Na żądanie");
    expect(
      wrapper.get("h2").find("[data-testid='section-info']").exists(),
    ).toBe(false);
    // Not printed until asked for.
    expect(wrapper.text()).not.toContain("Jedno uruchomienie");

    await bubble.trigger("click");
    expect(document.body.textContent).toContain(
      "Jedno uruchomienie na każde żądanie.",
    );
  });

  it("explains the section in a bubble, from the slot", async () => {
    const wrapper = await mountHead(
      { title: "Ciągłe" },
      { info: "<strong>Długie przebiegi</strong>, które opróżniają kolejkę." },
    );

    const bubble = wrapper.get("[data-testid='section-info']");
    expect(bubble.attributes("aria-label")).toBe("Co to jest: Ciągłe");

    await bubble.trigger("click");
    expect(document.body.textContent).toContain(
      "Długie przebiegi, które opróżniają kolejkę.",
    );
  });

  it("puts the section's own controls at the end of its line", async () => {
    const wrapper = await mountHead(
      { title: "Zamknięte", count: 3 },
      { default: "<button data-toggle>Pokaż zamknięte</button>" },
    );

    const actions = wrapper.get(".asec__actions");
    expect(actions.get("[data-toggle]").text()).toBe("Pokaż zamknięte");
    // Not inside the heading line, which is the title, count and bubble only.
    expect(wrapper.get(".asec__heading").find("[data-toggle]").exists()).toBe(
      false,
    );
    expect(wrapper.get("h2").text()).toBe("Zamknięte");
  });
});
