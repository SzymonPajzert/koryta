import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import PeopleProgress from "../../../app/components/chart/PeopleProgress.vue";
import type { ProgressStats } from "../../../server/api/stats/progress.get";

/** The figures the endpoint hands out, seeded to what koryta.pl was actually
 * serving when „liczby są mocno ściśnięte" was reported. The shares matter -
 * 12% / 7% / 81% is what put six digits inside ~64px of a 311px bar. */
let stats: ProgressStats = zero();

function zero(): ProgressStats {
  return {
    total: 0,
    approved: 0,
    reviewed: 0,
    toCheck: 0,
    withVotes: 0,
    withNotes: 0,
  };
}

registerEndpoint("/api/stats/progress", () => stats);

beforeEach(() => {
  stats = {
    total: 7330,
    approved: 914,
    reviewed: 513,
    toCheck: 5903,
    withVotes: 533,
    withNotes: 368,
  };
  // `useStats` is one `useAsyncData("site-progress")` shared by every caller in
  // the app, and the cache outlives a mount - without this the second case here
  // reads the first one's response.
  clearNuxtData("site-progress");
});

/** Mounts and waits for the counts.
 *
 * `useStats` does not await its own `useAsyncData`: Nuxt settles it before it
 * serialises a server rendered page, and awaiting it here would hold the home
 * page on this one card during a client side navigation. `mountSuspended`
 * therefore returns with the figures still at the zero they start from, which
 * is a real frame - see `useStats`'s own doc comment - but not the one any of
 * these cases is about.
 */
async function bar() {
  const wrapper = await mountSuspended(PeopleProgress);
  await vi.waitUntil(() => wrapper.text().includes("5903"), { timeout: 2000 });
  return wrapper;
}

/** Percentages off the inline style, to two decimals. */
function widths(wrapper: Awaited<ReturnType<typeof bar>>) {
  return wrapper
    .findAll(".stack-bar-segment")
    .map((s) => Number.parseFloat(s.attributes("style")!.match(/[\d.]+/)![0]!))
    .map((n) => Math.round(n * 100) / 100);
}

describe("ChartPeopleProgress", () => {
  it("gives each segment exactly its share of the bar", async () => {
    const wrapper = await bar();

    expect(widths(wrapper)).toEqual([12.47, 7, 80.53]);
    expect(widths(wrapper).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
  });

  it("takes the numbers off the bar below md", async () => {
    // The assertion that stands in for the bug. A flex item's default
    // `min-width: auto` is its min-content, so with a number inside it the
    // 7% segment could never be narrower than the string "513" and took the
    // difference out of its neighbours. With the only child display:none the
    // min-content is 0 and the widths above are the widths on screen. jsdom
    // runs no media query, so the class list is all that is checkable here.
    const wrapper = await bar();

    for (const number of wrapper.findAll(".stack-bar-segment span")) {
      expect(number.classes()).toContain("d-none");
      expect(number.classes()).toContain("d-md-inline");
    }
  });

  it("names every figure in a legend a phone reader can read", async () => {
    const wrapper = await bar();

    const legend = wrapper.get(".progress-legend");
    expect(legend.classes()).toContain("d-md-none");

    // Read span by span rather than off `li.text()`: Vue's compiler condenses
    // the whitespace between the three of them away, so the row's textContent
    // is one run of "Opublikowane914".
    const rows = legend.findAll("li").map((li) => {
      const spans = li.findAll("span");
      return [spans[1]!.text(), spans[2]!.text()];
    });
    expect(rows).toEqual([
      ["Opublikowane", "914"],
      ["Sprawdzone", "513"],
      ["Do sprawdzenia", "5903"],
    ]);
  });

  it("leads where the bar leads", async () => {
    const wrapper = await bar();

    const hrefs = (selector: string) =>
      wrapper.findAll(selector).map((a) => a.attributes("href"));

    expect(hrefs(".progress-legend a")).toEqual([
      "/eksploruj/tabela",
      "/pomoc",
      "/eksploruj/tabela?visibility=private",
    ]);
    expect(hrefs(".progress-legend a")).toEqual(hrefs(".stack-bar-segment"));
  });

  it("gives a segment with no text a name anyway", async () => {
    // Below md the link is a bare colour: no label, and the tooltip that used
    // to name it never opens on a touch screen.
    const wrapper = await bar();

    expect(
      wrapper
        .findAll(".stack-bar-segment")
        .map((s) => s.attributes("aria-label")),
    ).toEqual(["Opublikowane: 914", "Sprawdzone: 513", "Do sprawdzenia: 5903"]);
  });

  it("divides by nothing before the counts land", async () => {
    // Mounted without waiting, and against an endpoint that answers zero, so
    // this covers both states at once: the frame a client side navigation
    // paints before the request resolves, and a site with nothing in it. The
    // total is floored at 1 for exactly this, and the guard is that no width
    // reads NaN.
    stats = zero();
    const wrapper = await mountSuspended(PeopleProgress);

    expect(widths(wrapper)).toEqual([0, 0, 0]);
    expect(wrapper.html()).not.toContain("NaN");
  });
});
