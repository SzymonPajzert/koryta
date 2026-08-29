import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PublicCompany from "../../../app/components/chip/PublicCompany.vue";
import type { Company } from "../../../shared/model";

function company(fields: Partial<Company>): Company {
  return { type: "place", name: "Podmiot", ...fields } as Company;
}

async function labelOf(props: {
  company: Company | undefined;
  showUnknown?: boolean;
}) {
  return (await mountSuspended(PublicCompany, { props })).text();
}

describe("ChipPublicCompany", () => {
  it("calls a confirmed public owner what it is", async () => {
    expect(await labelOf({ company: company({ isPublic: true }) })).toContain(
      "Instytucja publiczna",
    );
  });

  it("never reads the scrapers' false as private", async () => {
    // KRS does not list the shareholders of a spółka akcyjna, so `false` is
    // what a company nobody could place looks like - Małopolska Agencja
    // Rozwoju Regionalnego among them.
    expect(
      await labelOf({
        company: company({ isPublic: false }),
        showUnknown: true,
      }),
    ).toContain("Właściciel nieustalony");
  });

  it("says the same when there is no flag at all", async () => {
    // Ministries and urzędy, which have no KRS entry to have been read.
    expect(
      await labelOf({ company: company({}), showUnknown: true }),
    ).toContain("Właściciel nieustalony");
  });

  it("keeps quiet about the unknown where it cannot be acted on", async () => {
    // Most rows of an employment list would carry it, which is noise.
    expect(await labelOf({ company: company({ isPublic: false }) })).toBe("");
  });

  it("states private once somebody has answered", async () => {
    expect(
      await labelOf({
        company: company({ isPublic: false, isPublicSource: "manual" }),
      }),
    ).toContain("Podmiot prywatny");
  });

  it("renders nothing when the edge does not lead to a company", async () => {
    expect(await labelOf({ company: undefined, showUnknown: true })).toBe("");
  });
});

async function chipOf(props: {
  company: Company | undefined;
  showUnknown?: boolean;
  compact?: boolean;
}) {
  return (await mountSuspended(PublicCompany, { props })).get(".v-chip");
}

/** `compact`, for the callers that repeat this chip down a list.
 *
 * jsdom evaluates no media query, so the classes are the checkable proxy for
 * what a 375px screen shows - the pixels are the visual suite's business.
 */
describe("ChipPublicCompany compact", () => {
  it("keeps the label in the markup for the stylesheet to hide", async () => {
    const chip = await chipOf({
      company: company({ isPublic: true }),
      compact: true,
    });

    expect(chip.classes()).toContain("chip--compact");
    const label = chip.get("span.d-none");
    expect(label.classes()).toContain("d-md-inline");
    expect(label.text()).toBe("Instytucja publiczna");
  });

  it("carries its own name, since no tooltip opens on a touch screen", async () => {
    // Below md the chip is an icon and nothing else, so the title is the only
    // accessible name it has. The v-tooltip is no help: it opens on hover, and
    // in the employment row the chip sits inside the row's anchor, so a tap
    // follows the link instead.
    const chip = await chipOf({
      company: company({ isPublic: true }),
      compact: true,
    });

    expect(chip.attributes("title")).toContain("skarbu państwa");
  });

  it("leaves every other caller exactly as it was", async () => {
    const chip = await chipOf({ company: company({ isPublic: true }) });

    expect(chip.classes()).not.toContain("chip--compact");
    expect(chip.attributes("title")).toBeUndefined();
    expect(chip.find(".d-none").exists()).toBe(false);
    expect(chip.text()).toBe("Instytucja publiczna");
  });
});
