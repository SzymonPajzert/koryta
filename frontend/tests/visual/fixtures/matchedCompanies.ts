import type { Page } from "@playwright/test";
import { askedAbout } from "./elections";
import { answerForTheSector, SECTOR, STAND_IN } from "./obronnosc";

/** Seeded places each of the stand-in's people is given as well, so that a
 * row lists more than the one employer the sector matched, and the match has
 * somewhere to be moved forward from. */
const OTHER_EMPLOYERS = [
  { id: "2", name: "Orlen" },
  { id: "chain-company", name: "Firma Testowa" },
];

/** The person whose own employer is not in the sector, only owned by a company
 * that is - 722 of the 1,596 people in energetyka on the 2026-10-29 export. Their
 * row names that company instead. */
export const THROUGH = "sukfranciszek";
const OWNER = {
  id: "owner-stand-in",
  name: "POLSKA GRUPA ZBROJENIOWA (Radom)",
};

/** Answers the table's requests for the sector the way ./obronnosc.ts does -
 * with the stand-in company's people, as the server gives them, its `matched`
 * included - and then gives every one of them the two other employers, and
 * moves one of them to a company above their employer. */
export async function answerWithMatches(page: Page) {
  await answerForTheSector(page, { queue: false });

  // Registered after ./obronnosc.ts's own, so Playwright runs it first.
  await page.route(
    (url) =>
      url.pathname === "/api/nodes" &&
      url.searchParams.get("category") === SECTOR,
    async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.delete("category");
      url.searchParams.set("place", STAND_IN);
      const response = await route.fetch({ url: url.toString() });
      const answer = (await response.json()) as {
        matched?: Record<string, string[]>;
        matchedPlaces?: Record<string, string>;
      };
      await route.fulfill({
        response,
        json: {
          ...answer,
          matched: { ...answer.matched, [THROUGH]: [OWNER.id] },
          matchedPlaces: { ...answer.matchedPlaces, [OWNER.id]: OWNER.name },
        },
      });
    },
  );

  await page.route("**/api/graph/local/**", async (route) => {
    const response = await route.fetch();
    const graph = (await response.json()) as {
      nodes?: Record<string, unknown>;
      edges?: unknown[];
    };
    const places = Object.fromEntries(
      OTHER_EMPLOYERS.map(({ id, name }) => [
        id,
        { id, name, type: "rect", color: "#9e9e9e", entityType: "place" },
      ]),
    );
    const jobs = askedAbout(route).flatMap((person) =>
      OTHER_EMPLOYERS.map(({ id }) => ({
        id: `${person}-${id}`,
        source: person,
        target: id,
        type: "employed",
        label: "pracuje",
        start_date: "2019-03-01",
        end_date: "2021-06-30",
      })),
    );
    await route.fulfill({
      response,
      json: {
        ...graph,
        nodes: { ...graph.nodes, ...places },
        edges: [...(graph.edges ?? []), ...jobs],
      },
    });
  });
}
