import type { Page, Route } from "@playwright/test";

/** The sector the captures in ../obronnosc.spec.ts are of. */
export const SECTOR = "obronnosc";

/** A seeded company whose board stands in for the defence sector's:
 * „Wojewódzki Zakład Testowy”, which has four people in a post now.
 *
 * No seeded company carries `categories` (adding one would move the three
 * baselines that photograph seeded companies), so the server finds nobody
 * under any sector. Its answer for this company is the next best thing: real
 * people, real relations, and a count, all from the server itself. */
export const STAND_IN = "sukspolka";

/** The conditions /eksploruj/nowe adds to say "the queue": a draft, nobody's
 * vote on it, a score floor. The seed publishes everybody and computes no
 * votes, so with them the stand-in's people are nobody too. */
const QUEUE_CONDITIONS = ["visibility", "hideVoted", "minVotes"];

const asksFor = (url: URL, path: string, category: string) =>
  url.pathname === path && url.searchParams.get("category") === category;

/** Answers the pages' requests for the sector - the people, and the progress
 * bar's counts - with the stand-in company's, as the server gives them.
 *
 * `queue` drops the queue's own conditions from the people request, so the
 * queue has somebody in it and says how many. The request itself is left as
 * the page made it, which is what the specs assert the sector reached.
 * `category` is another category to answer for the same way: Skarb Państwa,
 * in ../skarb-panstwa.spec.ts. */
export async function answerForTheSector(
  page: Page,
  { queue, category = SECTOR }: { queue: boolean; category?: string },
) {
  const standIn = (route: Route) => {
    const url = new URL(route.request().url());
    url.searchParams.delete("category");
    url.searchParams.set("place", STAND_IN);
    if (queue) {
      for (const key of QUEUE_CONDITIONS) url.searchParams.delete(key);
    }
    return url.toString();
  };

  await page.route(
    (url) => asksFor(url, "/api/nodes", category),
    async (route) =>
      route.fulfill({ response: await route.fetch({ url: standIn(route) }) }),
  );
  await page.route(
    (url) => asksFor(url, "/api/stats/progress", category),
    async (route) =>
      route.fulfill({ response: await route.fetch({ url: standIn(route) }) }),
  );
}
