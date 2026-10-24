import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import EntityFacts, {
  type EntityFact,
} from "../../../app/components/entity/Facts.vue";

const NBSP = "\u00a0";

const mountFacts = (facts: EntityFact[], slot?: string) =>
  mountSuspended(EntityFacts, {
    props: { facts },
    slots: slot ? { default: slot } : {},
  });

/** The facts line's style block. No stylesheet is applied in the test DOM, so
 * the dot is read from the file. `import.meta.url` is not a file url under the
 * Nuxt test environment, hence cwd. */
const RELATIVE = "app/components/entity/Facts.vue";
const style = (() => {
  const source = readFileSync(
    existsSync(resolve(process.cwd(), RELATIVE))
      ? resolve(process.cwd(), RELATIVE)
      : resolve(process.cwd(), "frontend", RELATIVE),
    "utf8",
  );
  return source.slice(source.indexOf("<style"));
})();

/** The one line of facts under an entity's name: „ur. 16 stycznia 1975 ·
 * Wikipedia ↗ · Rejestr.io ↗” on a person, „KRS: 0000026981 ↗ · Lokalizacja:
 * Tarnów · Wikipedia ↗” on a company - one recipe for both headers, which
 * used to set the same facts two ways. */
describe("EntityFacts", () => {
  it("sets each label apart from its value by a space that does not break", async () => {
    // Vue drops the whitespace between two tags, and „REGON:123456785” read
    // as one number.
    const wrapper = await mountFacts([
      { key: "regon", label: "REGON:", value: "123456785", testid: "regon" },
    ]);

    const item = wrapper.get("[data-testid='regon']");
    expect(item.get(".entity-facts__label").element.textContent).toBe(
      `REGON:${NBSP}`,
    );
    // One plain space first, for a reader of the text: the dot between two
    // facts is CSS, and the text ran „1975Wikipedia”. Never drawn, at the
    // start of a flex item.
    expect(item.element.textContent).toBe(` REGON:${NBSP}123456785`);
  });

  it("links a value off the site, in a new tab, with the arrow that says so", async () => {
    const wrapper = await mountFacts([
      {
        key: "wikipedia",
        value: "Wikipedia",
        url: "https://pl.wikipedia.org/wiki/Tauron",
        testid: "wikipedia",
      },
    ]);

    const link = wrapper.get("[data-testid='wikipedia'] a");
    expect(link.attributes("href")).toBe(
      "https://pl.wikipedia.org/wiki/Tauron",
    );
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener");
    // The underline is under the name alone, not under the gap before the
    // arrow, and the arrow is not read out.
    expect(link.get(".entity-facts__name").text()).toBe("Wikipedia");
    expect(link.get(".v-icon").attributes("aria-hidden")).toBe("true");
    // A value that names itself takes no label.
    expect(wrapper.find(".entity-facts__label").exists()).toBe(false);
  });

  it("leaves a fact with no url as plain text", async () => {
    const wrapper = await mountFacts([
      { key: "location", label: "Lokalizacja:", value: "Tarnów" },
    ]);

    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).toBe(`Lokalizacja:${NBSP}Tarnów`);
  });

  it("keeps a one-letter word on the line of the word after it", async () => {
    // On a phone „magister zarządzania w turystyce i sporcie” ended a line on
    // its lone „i”: the value is data, which cannot write its own &nbsp;.
    const wrapper = await mountFacts([
      {
        key: "education",
        label: "wykształcenie:",
        value: "magister zarządzania w turystyce i sporcie",
      },
    ]);

    expect(wrapper.text()).toContain(
      `magister zarządzania w${NBSP}turystyce i${NBSP}sporcie`,
    );
  });

  it("divides the facts with a dot a screen reader does not read", async () => {
    // The dot is drawn by the stylesheet, before every fact but the first,
    // so it is in no fact's text - „· Rejestr.io” - and its empty
    // alternative keeps it out of what a screen reader says.
    const wrapper = await mountFacts([
      { key: "birth", label: "ur.", value: "16 stycznia 1975" },
      { key: "wikipedia", value: "Wikipedia", url: "https://pl.wikipedia.org" },
      { key: "rejestrIo", value: "Rejestr.io", url: "https://rejestr.io" },
    ]);

    expect(wrapper.findAll(".entity-facts__item")).toHaveLength(3);
    expect(wrapper.text()).not.toContain("·");
    expect(style).toMatch(
      /\.entity-facts__item \+ \.entity-facts__item::before \{[^}]*content: "·" \/ "";/,
    );
  });

  it("sets what the page adds after the facts, with no dot before it", async () => {
    const wrapper = await mountFacts(
      [{ key: "krs", label: "KRS:", value: "0000026981" }],
      "<span class='chips'>Instytucja publiczna</span>",
    );

    // Not an item of the line, so the dot's rule never reaches it.
    const chips = wrapper.get(".chips");
    expect(chips.classes()).not.toContain("entity-facts__item");
    expect(wrapper.get(".entity-facts").element.lastElementChild).toBe(
      chips.element,
    );
  });
});
