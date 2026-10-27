import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import FilterPanel from "../../../app/components/form/EksplorujTabelaFilterPanel.vue";
import {
  AA_TEXT,
  contrastRatio,
  ink,
  readableInkOn,
  surface,
} from "../../../shared/colors";
import { partyColors } from "../../../shared/misc";

// Vuetify's menus observe their activator, and happy-dom ships no
// ResizeObserver - the autocompletes throw without this.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mount = (props: Record<string, unknown> = {}) =>
  mountSuspended(FilterPanel, {
    props: {
      availableParties: [
        { title: "Nowa Lewica", value: "Nowa Lewica" },
        { title: "Konfederacja", value: "Konfederacja" },
        { title: "Razem", value: "Razem" },
      ],
      availableRegions: [{ title: "Mazowieckie", value: "teryt14" }],
      availableCompanies: [{ title: "Spółka", value: "company-1" }],
      ...props,
    },
  });

/** An inline colour comes back as `rgb(212, 14, 32)` from some DOM
 * implementations and as the hex it was written with from others. */
const hex = (colour: string) => {
  const parsed = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(colour);
  return parsed
    ? `#${parsed
        .slice(1)
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("")}`
    : colour.toLowerCase();
};

const chipColours = (element: Element) => {
  const style = (element as HTMLElement).style;
  return [hex(style.color), hex(style.backgroundColor)] as const;
};

/** Vuetify draws `.v-field__input` at `--v-high-emphasis-opacity`, which
 * composites everything inside it - a chip's fill included - against what is
 * behind the field. */
const FIELD_INPUT_OPACITY = 0.87;

const overWhite = (colour: string, alpha: number) =>
  `#${[1, 3, 5]
    .map((start) =>
      Math.round(
        parseInt(colour.slice(start, start + 2), 16) * alpha +
          255 * (1 - alpha),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** The style block is the whole of the fix below, and no stylesheet is applied
 * in the test DOM - `getComputedStyle` here would report Vuetify's default
 * whatever we wrote. So the rule is read from the file. `import.meta.url` is
 * not a file url under the Nuxt test environment, hence cwd. */
const RELATIVE = "app/components/form/EksplorujTabelaFilterPanel.vue";
const sourcePath = existsSync(resolve(process.cwd(), RELATIVE))
  ? resolve(process.cwd(), RELATIVE)
  : resolve(process.cwd(), "frontend", RELATIVE);
const source = readFileSync(sourcePath, "utf8");

describe("the filter panel's party chips", () => {
  it("paints a chosen party in its own colour, under the ink measured for it", async () => {
    const wrapper = await mount({ party: ["Nowa Lewica"] });

    const chip = wrapper.find(".v-autocomplete .v-chip");
    expect(chip.exists()).toBe(true);
    const [chipInk, background] = chipColours(chip.element);

    expect(background).toBe(partyColors["Nowa Lewica"]!.toLowerCase());
    expect(chipInk).toBe(readableInkOn(partyColors["Nowa Lewica"]!));
    expect(contrastRatio(chipInk, background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /** Why the style block lifts `.v-field__input`'s opacity. Faded, the reddest
   * party in the list is the pair that decides it: #D40E20 is composited to a
   * lighter red and the white label `readableInkOn` chose for the declared
   * fill loses most of its headroom. A chip cannot opt out of an ancestor's
   * opacity, so the rule is the only thing keeping the measured colour on
   * screen. */
  it("keeps the declared fill on screen rather than an 87% composite of it", () => {
    const fill = partyColors["Nowa Lewica"]!;
    const chipInk = readableInkOn(fill);
    const faded = overWhite(fill, FIELD_INPUT_OPACITY);

    expect(faded).not.toBe(fill.toLowerCase());
    expect(contrastRatio(chipInk, faded)).toBeLessThan(
      contrastRatio(chipInk, fill),
    );

    expect(source).toMatch(/:deep\(\.v-field__input\)\s*\{[^}]*opacity:\s*1;/);
  });

  /** Several of the parties the filter offers have no colour in `shared/misc`
   * - Razem's is commented out - and a flat chip with no background of its own
   * falls back to Vuetify's `surface-variant`, #424242 under near-black ink. */
  it("keeps a party with no colour of its own readable", async () => {
    const wrapper = await mount({ party: ["Razem"] });

    const chip = wrapper.find(".v-autocomplete .v-chip");
    const [chipInk, background] = chipColours(chip.element);

    expect(partyColors.Razem).toBeUndefined();
    expect(background).toBe(surface.muted);
    expect(chipInk).toBe(ink.neutral);
    expect(contrastRatio(chipInk, background)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("the filter panel's elections", () => {
  const electionField = (wrapper: Awaited<ReturnType<typeof mount>>) =>
    wrapper
      .findAll(".v-autocomplete")
      .find((field) => field.text().includes("Wybory"));

  /** A question about the person, so in the block that answers those - in the
   * cell the three filters there left empty - and not a click lower under
   * „Więcej filtrów”, where a new filter would be found by nobody. */
  it("offers them among the person's filters, not under „Więcej filtrów”", async () => {
    const wrapper = await mount();

    const field = electionField(wrapper)!;
    expect(field.element.closest(".v-expansion-panel")).toBeNull();
    // The same row as „Region osoby”: the first block's grid.
    const row = field.element.closest(".v-row");
    expect(row?.textContent).toContain("Region osoby");
  });

  it("names a chosen election the way the list does", async () => {
    const wrapper = await mount({ election: ["parliament-2023"] });

    expect(electionField(wrapper)!.find(".v-chip").text()).toBe(
      "Sejm i Senat 2023",
    );
  });

  it("counts the elections as one filter of their group", async () => {
    const wrapper = await mount({
      election: ["parliament-2023", "local-2024"],
    });

    expect(wrapper.text()).toContain("1 filtr");
  });
});

describe("the filter panel's election result", () => {
  /** The choice is made inside the list, so once the list closes the field's
   * label is the only thing on screen that says it. */
  it("names a chosen result in the field's label", async () => {
    const wrapper = await mount({
      election: ["parliament-2023"],
      electionResult: "won",
    });

    const field = wrapper
      .findAll(".v-autocomplete")
      .find((candidate) => candidate.text().includes("Wybory"));
    expect(field!.find("label").text()).toBe("Wybory: wygrali");
  });

  it("keeps the plain label for „Kandydowali”", async () => {
    const wrapper = await mount({
      election: ["parliament-2023"],
      electionResult: "all",
    });

    const field = wrapper
      .findAll(".v-autocomplete")
      .find((candidate) => candidate.text().includes("Wybory"));
    expect(field!.find("label").text()).toBe("Wybory");
  });
});
