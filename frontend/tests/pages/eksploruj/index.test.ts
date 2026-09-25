import { describe, it, expect, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import EksplorujPage from "../../../app/pages/eksploruj/index.vue";
import type { DatabaseStats } from "../../../server/api/stats/database.get";

/** What `/api/stats/database` answers this run. `null` makes it fail, which is
 * the case the page has to survive: the endpoint is a census of the whole
 * database behind a six-hour cache, so a cold miss under load is the one way
 * this landing page loses its numbers. */
let response: Pick<DatabaseStats, "nodes" | "edges" | "generatedAt"> | null =
  null;

registerEndpoint("/api/stats/database", () => {
  if (!response) throw new Error("stats unavailable");
  return response;
});

/** The measured shape of prod on 2026-09-14, cut down to the fields the page
 * picks. Real numbers rather than round ones, because what is being asserted is
 * that they come out declined and grouped - "10 348 osob", not "10348 osoby". */
function stats(): Pick<DatabaseStats, "nodes" | "edges" | "generatedAt"> {
  return {
    generatedAt: "2026-09-14T06:30:00.000Z",
    nodes: {
      total: 17292,
      people: 10348,
      places: 4928,
      articles: 627,
      regions: 1389,
    },
    edges: 49036,
  };
}

/** `polishNumber` groups thousands with U+00A0 - deliberately, so a figure
 * never wraps between the "10" and the "348" - while the expectations below
 * are written with ordinary spaces. Escaped and not typed: an invisible
 * non-breaking space in a source file is what `no-irregular-whitespace` exists
 * to stop, and eslint fails the file for one. */
function text(value: string): string {
  return value.replace(/\u00a0/g, " ");
}

beforeEach(() => {
  response = stats();
  clearNuxtData();
});

describe("/eksploruj", () => {
  it("lists every way to explore, in order, each as one whole-card link", async () => {
    const wrapper = await mountSuspended(EksplorujPage);

    // The order is the page's argument: what a stranger can read without an
    // account comes first, and the plumbing - statistics, charts, sources -
    // last.
    expect(
      wrapper
        .findAll("[data-testid^='explore-way-']")
        .map((card) => card.attributes("data-testid")),
    ).toEqual([
      "explore-way-tabela",
      "explore-way-umowy",
      "explore-way-nowe",
      "explore-way-staz",
      "explore-way-szpitale",
      "explore-way-statystyki",
      "explore-way-autograf",
      "explore-way-graf",
      "explore-way-tematy",
      "explore-way-zrodla",
    ]);

    // Every route linked here is a page that exists; a directory whose entries
    // 404 is worse than no directory. The paths are asserted rather than the
    // labels, because it is the paths that rot silently - `/umowy` was deleted
    // and folded into `/eksploruj/umowy` the same day this was written.
    expect(
      wrapper.findAll("[data-testid^='explore-way-']").map((card) => ({
        href: card.attributes("href"),
        heading: card.find("h2").exists(),
      })),
    ).toEqual([
      { href: "/eksploruj/tabela", heading: true },
      { href: "/eksploruj/umowy", heading: true },
      { href: "/eksploruj/nowe", heading: true },
      { href: "/eksploruj/staz", heading: true },
      { href: "/eksploruj/szpitale", heading: true },
      { href: "/eksploruj/statystyki", heading: true },
      { href: "/eksploruj/autograf", heading: true },
      { href: "/graf", heading: true },
      { href: "/tematy", heading: true },
      { href: "/zrodla", heading: true },
    ]);
  });

  it("declines and groups every count it prints", async () => {
    const wrapper = await mountSuspended(EksplorujPage);
    const counted = Object.fromEntries(
      wrapper
        .findAll("[data-testid^='explore-way-']")
        .map((card) => [
          card.attributes("data-testid"),
          card.find(".way__count").exists()
            ? text(card.get(".way__count").text())
            : null,
        ]),
    );

    expect(counted).toEqual({
      "explore-way-tabela": "10 348 osób w bazie",
      "explore-way-umowy": null,
      "explore-way-nowe": null,
      "explore-way-staz": null,
      "explore-way-szpitale": null,
      "explore-way-statystyki": "17 292 strony w serwisie",
      // pl-PL groups from five digits (CLDR minimumGroupingDigits 2)
      "explore-way-autograf": "4928 instytucji i spółek",
      "explore-way-graf": "49 036 powiązań",
      "explore-way-tematy": null,
      "explore-way-zrodla": "627 artykułów",
    });
  });

  it("marks what is new and what needs an account, and nothing else", async () => {
    const wrapper = await mountSuspended(EksplorujPage);
    const badges = wrapper
      .findAll("[data-testid^='explore-way-']")
      .filter((card) => card.find(".way__badge").exists())
      .map((card) => [
        card.attributes("data-testid"),
        card.get(".way__badge").text(),
      ]);

    // The second one is not decoration: /eksploruj/nowe carries
    // `middleware: "auth"`, so tapping it signed out is a bounce to /login.
    expect(badges).toEqual([
      ["explore-way-umowy", "nowość"],
      ["explore-way-nowe", "po zalogowaniu"],
    ]);
  });

  it("says how old the numbers are, in Warsaw time", async () => {
    // 00:30 UTC is 02:30 on the 14th in Warsaw. This is the case an implicit
    // zone gets wrong: the box runs UTC, so anything generated in the two
    // hours before midnight UTC would be printed as the previous day.
    response = { ...stats(), generatedAt: "2026-09-14T00:30:00.000Z" };
    const wrapper = await mountSuspended(EksplorujPage);

    expect(text(wrapper.text())).toContain(
      "Liczby ze stanu bazy z 14 września 2026",
    );
  });

  it("still lists every way when the stats call fails", async () => {
    response = null;
    const wrapper = await mountSuspended(EksplorujPage);

    expect(wrapper.findAll("[data-testid^='explore-way-']")).toHaveLength(10);
    // No dash, no "undefined", no empty count line: a card with no figure to
    // show simply has none.
    expect(wrapper.findAll(".way__count")).toHaveLength(0);
    expect(text(wrapper.text())).not.toContain("Liczby ze stanu bazy");
    expect(wrapper.text()).not.toContain("undefined");
    expect(wrapper.text()).not.toContain("NaN");
  });
});
