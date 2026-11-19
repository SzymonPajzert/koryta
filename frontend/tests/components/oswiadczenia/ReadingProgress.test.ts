import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ReadingProgress from "../../../app/components/oswiadczenia/ReadingProgress.vue";
import { ink } from "../../../app/utils/chartTheme";
import { brand, role } from "../../../shared/colors";
import { SEEDED_DECLARATION_PEOPLE as people } from "../../../scripts/declarationPeople";

// Vuetify's tooltip observes its activator.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

/** The seed's people: 300 published, 60 held, 50 namesakes and 10
 * misreadings were read; 90 have a crop waiting. */
const DONE = 420;
const WAITING = 90;

const mountLine = (yours: number) =>
  mountSuspended(ReadingProgress, { props: { people, yours } });

/** The parts of the line, left to right: how much of it each takes, and its
 * colour. */
function partsOf(wrapper: Awaited<ReturnType<typeof mountLine>>) {
  return wrapper.findAll(".reading-progress__part").map((part) => {
    const style = part.attributes("style") ?? "";
    return {
      grow: Number(/flex-grow:\s*([\d.]+)/.exec(style)?.[1]),
      color: style,
    };
  });
}

const isOpen = (wrapper: Awaited<ReturnType<typeof mountLine>>) =>
  wrapper.findComponent({ name: "VTooltip" }).props("modelValue");

describe("OswiadczeniaReadingProgress", () => {
  it("draws the people read and the people waiting, the reader's part at the end of the read", async () => {
    const wrapper = await mountLine(12);

    const parts = partsOf(wrapper);
    expect(parts.map((part) => part.grow)).toEqual([DONE - 12, 12, WAITING]);
    // The reader's part in the tally's Oliwka, between the read and the rest:
    // at the start it would sit under the Oliwka pane of the tally above.
    expect(parts[1]!.color).toContain(role.tally);
    expect(parts[0]!.color).toContain(brand.primary);
    expect(parts[2]!.color).toContain(ink.track);
  });

  it("never draws more of the reader than all that was read", async () => {
    // Their part is crops and the line is people: a heavy reader can read
    // more crops than there are people done.
    const wrapper = await mountLine(5000);

    expect(partsOf(wrapper).map((part) => part.grow)).toEqual([DONE, WAITING]);
  });

  it("leaves the reader's part out until they read something", async () => {
    const wrapper = await mountLine(0);

    expect(partsOf(wrapper).map((part) => part.grow)).toEqual([DONE, WAITING]);
  });

  it("says what it shows to a screen reader", async () => {
    const wrapper = await mountLine(12);

    expect(wrapper.get("button").attributes("aria-label")).toBe(
      "Gotowe osoby: 420 z 510. Twoje odczyty: 12.",
    );
  });

  it("opens its words while a mouse is over it", async () => {
    const wrapper = await mountLine(12);
    const line = wrapper.get("button");

    expect(isOpen(wrapper)).toBe(false);
    await line.trigger("pointerenter", { pointerType: "mouse" });
    expect(isOpen(wrapper)).toBe(true);
    await line.trigger("pointerleave", { pointerType: "mouse" });
    expect(isOpen(wrapper)).toBe(false);
  });

  it("opens them on a tap and keeps them open", async () => {
    // A tap comes as a touch arriving and then a click. The tooltip's own
    // hover closed what the tap opened, so a phone never showed the words.
    const wrapper = await mountLine(12);
    const line = wrapper.get("button");

    await line.trigger("pointerenter", { pointerType: "touch" });
    expect(isOpen(wrapper)).toBe(false);
    await line.trigger("click");
    expect(isOpen(wrapper)).toBe(true);
    await line.trigger("click");
    expect(isOpen(wrapper)).toBe(true);
  });
});
