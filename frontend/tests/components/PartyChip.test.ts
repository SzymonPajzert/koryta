import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PartyChip from "../../app/components/PartyChip.vue";
import { partyColors } from "../../shared/misc";
import { AA_TEXT, contrastRatio, surface } from "../../shared/colors";

/** The ink the chip settled on. jsdom keeps a hex colour verbatim, which is
 * the form `contrastRatio` takes; the assertion is here so that a colour it
 * did rewrite fails as itself rather than as an unreadable ratio. */
const inkOf = (party: string): string => {
  const chip = mount(PartyChip, { props: { party } }).get(".chip");
  const color = (chip.element as HTMLElement).style.color;
  expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  return color;
};

describe("PartyChip", () => {
  it("renders party name", () => {
    const wrapper = mount(PartyChip, {
      props: {
        party: "PiS",
      },
    });

    expect(wrapper.text()).toContain("PiS");
  });

  it("applies correct background color", () => {
    const wrapper = mount(PartyChip, {
      props: {
        party: "PO",
      },
    });

    const span = wrapper.find("span");
    expect(span.attributes("style")).toContain(
      "background-color: " + partyColors["PO"].replace(/,/g, ", "),
    );
  });
  /** The chip is the whole of what this component draws. The `<div>` it used
   * to be wrapped in gave `text-overflow: ellipsis` nothing to clip, so the
   * 120px cap /eksploruj/tabela puts on the chip on a phone did nothing, and
   * in card/PeopleList's `#append` the chips stacked one per line above the
   * chevron rather than sitting beside it.
   *
   * Asserted on the element rather than on `wrapper.element`: the comment
   * above the template's root makes this a fragment in a dev build, so
   * `wrapper` addresses the holder test-utils mounts into, not the chip. */
  it("is one inline chip, with no block wrapper around it", () => {
    const wrapper = mount(PartyChip, { props: { party: "PiS" } });

    expect(wrapper.get(".chip").element.tagName).toBe("SPAN");
    expect(wrapper.find("div").exists()).toBe(false);
  });

  /** `partyColors` names nine parties and the data has more - Razem is
   * commented out there. Those get no inline background at all: the string
   * "undefined" reaching the style attribute is what a plain lookup would
   * write there, and a caller that wants a fill for them paints one itself. */
  it("emits no fill for a party it has no colour for", () => {
    const wrapper = mount(PartyChip, { props: { party: "Razem" } });

    const chip = wrapper.get(".chip");
    expect(chip.text()).toBe("Razem");
    expect(chip.attributes("style")).not.toContain("background-color");
    expect(chip.attributes("style")).not.toContain("undefined");
  });

  /** The ink was a three-name map with a near-black fallback, so Konfederacja
   * (#102440) painted #090707 on navy at 1.29:1 and SLD (#D40E20) was one step
   * behind it. Measured against every fill rather than the two that were
   * reported, so that a colour added to `partyColors` cannot arrive
   * unreadable. */
  it.each(Object.keys(partyColors))(
    "gives %s ink that clears AA on its own fill",
    (party) => {
      expect(
        contrastRatio(inkOf(party), partyColors[party]!),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  /** The reported chip: near-black ink on near-black navy. White is the only
   * one of the two inks that reads on it. */
  it("puts white ink on Konfederacja's navy", () => {
    expect(inkOf("Konfederacja")).toBe(surface.white);
  });
});
