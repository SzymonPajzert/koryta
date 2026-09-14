import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Headline from "../../../app/components/contract/Headline.vue";
import type { ContractCoverage } from "../../../shared/contracts";

/** The rule this file exists to hold: **not one figure and not one date in the
 * headline is a literal.**
 *
 * The window grows the moment `CruUmowy` runs again, so a hardcoded „od 1 lipca
 * do 10 sierpnia 2026" - or a count typed out beside a number read from the
 * document - becomes a false claim about what this site covers, with nothing
 * failing and nothing able to notice. The assertions below all work the same
 * way: render two different coverage documents and require that every number
 * and both dates moved with them.
 *
 * The second thing it holds is the Polish. `polishCountingGrouped` declines
 * three ways and the counts here run from 1 to six digits, which is exactly the
 * range where „1 284 umowa" and „21 umowa" get written by hand.
 */
function coverage(fields: Partial<ContractCoverage> = {}): ContractCoverage {
  return {
    total: 149_683,
    stored: 149_683,
    linked: 13_333,
    bothLinked: 154,
    companies: 825,
    namedPeople: 558,
    withIndividual: 18_505,
    registerInstitutions: 12_858,
    from: "2026-07-01",
    to: "2026-08-10",
    computedAt: "2026-09-14T08:44:06.649Z",
    sources: ["cru"],
    ...fields,
  };
}

/** `Intl` groups with a narrow no-break space and the tiles print through
 * `formatCompact`, which does the same. Neither is typeable. */
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

describe("ContractHeadline", () => {
  it("prints the linked count, the register total and the window", async () => {
    const wrapper = await mountSuspended(Headline, {
      props: { coverage: coverage() },
    });
    const text = plain(wrapper.text());

    expect(text).toContain("13 333 umowy");
    expect(text).toContain("149 683");
    expect(text).toContain("1 lipca 2026");
    expect(text).toContain("10 sierpnia 2026");
  });

  it("moves every figure and both dates when the coverage does", async () => {
    // The whole point. If any of these were typed into the template rather than
    // read off the document, this is the assertion that catches it.
    const wrapper = await mountSuspended(Headline, {
      props: {
        coverage: coverage({
          total: 200_000,
          linked: 42,
          companies: 7,
          namedPeople: 3,
          bothLinked: 1,
          from: "2027-01-02",
          to: "2027-02-03",
        }),
      },
    });
    const text = plain(wrapper.text());

    expect(text).toContain("42 umowy");
    expect(text).toContain("200 000");
    expect(text).toContain("2 stycznia 2027");
    expect(text).toContain("3 lutego 2027");
    // And nothing of the previous document survived.
    expect(text).not.toContain("13 333");
    expect(text).not.toContain("149 683");
    expect(text).not.toContain("2026");
  });

  it("declines umowa the three ways Polish does", async () => {
    const forms: [number, string][] = [
      [1, "1 umowa"],
      [3, "3 umowy"],
      [13, "13 umów"],
      // Not „21 umowa": everything but a bare one takes the plural or the
      // genitive, which is the rule `nominativeNoun` was corrected for after it
      // printed „371 rocznica" on a page counting them.
      [21, "21 umów"],
      [13_333, "13 333 umowy"],
    ];
    for (const [linked, expected] of forms) {
      const wrapper = await mountSuspended(Headline, {
        props: { coverage: coverage({ linked }) },
      });
      expect(plain(wrapper.text())).toContain(expected);
    }
  });

  it("carries the tint that answers the blank page, not a bare div", async () => {
    // „Very blank ... it doesn't have any background color" is what this band
    // was added for, so the class carrying the tint is load-bearing rather than
    // cosmetic and a refactor that drops it undoes the fix silently.
    const wrapper = await mountSuspended(Headline, {
      props: { coverage: coverage() },
    });
    expect(wrapper.find(".umowy-hero").exists()).toBe(true);
    expect(wrapper.find('[data-testid="umowy-headline"]').exists()).toBe(true);
  });

  it("shows the reach as figures rather than as a run-on sentence", async () => {
    const wrapper = await mountSuspended(Headline, {
      props: { coverage: coverage() },
    });
    const text = plain(wrapper.text());

    expect(text).toContain("Instytucje");
    expect(text).toContain("825");
    expect(text).toContain("Osoby");
    expect(text).toContain("558");
    expect(text).toContain("Obie strony");
    expect(text).toContain("154");
  });
});
