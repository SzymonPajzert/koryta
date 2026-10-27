import type { Page, Route } from "@playwright/test";

/** The election the captures in ../election-filter.spec.ts are filtered by. */
export const ELECTION = "parliament-2023";

/** A seeded company whose board stands in for the people who ran in it:
 * „Wojewódzki Zakład Testowy”.
 *
 * The seed holds no candidacy, and adding some would move every baseline that
 * photographs a seeded person, so the server finds nobody under any election.
 * Its answer for this company is the next best thing: real people, from the
 * server itself, to which the runs below are added. */
export const STAND_IN = "sukspolka";

/** Where the made-up runs were stood in: a seeded region, so each chip names a
 * place the site has. */
const REGION = { id: "teryt22", name: "Województwo Pomorskie", teryt: "22" };

/** Two runs a person: a 2018 local one, and the 2023 parliamentary one the
 * filter matches - won by every other person, so the mark of a win is on some
 * rows and not on others. */
function runsFor(ids: string[]) {
  return ids.flatMap((id, index) => [
    {
      id: `${id}-2018`,
      source: id,
      target: REGION.id,
      type: "election",
      label: "kandydatura",
      name: "kandydatura",
      position: "Rada powiatu",
      start_date: "2018-10-21",
    },
    {
      id: `${id}-2023`,
      source: id,
      target: REGION.id,
      type: "election",
      label: "kandydatura",
      name: "kandydatura",
      position: "Sejm",
      start_date: "2023-10-15",
      ...(index % 2 === 0 ? { elected: true } : {}),
    },
  ]);
}

/** The people the subgraph request is about: the one in its path, then the
 * rest of the page's rows in its body. */
function askedAbout(route: Route): string[] {
  const first = new URL(route.request().url()).pathname.split("/").pop()!;
  const body = route.request().postDataJSON() as { subjects?: string } | null;
  return [first, ...(body?.subjects ?? "").split(",").filter(Boolean)];
}

/** Answers the table's requests for the election: the people with the
 * stand-in company's, as the server gives them, and their relations with the
 * runs added.
 *
 * The people request is left as the page made it, which is what the spec
 * asserts the filter reached. Only its answer is somebody else's. */
export async function answerForTheElection(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/nodes" && url.searchParams.has("election"),
    async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.delete("election");
      url.searchParams.delete("electionResult");
      url.searchParams.set("place", STAND_IN);
      await route.fulfill({
        response: await route.fetch({ url: url.toString() }),
      });
    },
  );
  await page.route("**/api/graph/local/**", async (route) => {
    const response = await route.fetch();
    const graph = (await response.json()) as {
      nodes?: Record<string, unknown>;
      edges?: unknown[];
    };
    await route.fulfill({
      response,
      json: {
        ...graph,
        nodes: {
          ...graph.nodes,
          [REGION.id]: {
            name: REGION.name,
            type: "circle",
            color: "#9e9e9e",
            entityType: "region",
            teryt: REGION.teryt,
          },
        },
        edges: [...(graph.edges ?? []), ...runsFor(askedAbout(route))],
      },
    });
  });
}
