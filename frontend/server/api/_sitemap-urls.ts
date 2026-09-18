import { generateEntityUrl } from "~~/app/composables/slugs";
import { sitemapLastmod } from "~~/shared/lastmod";
import { type NodeType, pageIsPublic } from "~~/shared/model";

/** Node types whose entity page renders a page of its own.
 *
 * `region` is deliberately absent. A region has no page of its own:
 * app/composables/slugs.ts `generateNodeUrl` sends every one to
 * `/eksploruj/tabela?teryt=...`, and app/pages/[seoType]/[slug].vue then
 * redirects there on the server - so listing them advertised URLs that exist
 * only to bounce a crawler into the heaviest response on the site, and one
 * robots.txt blocks besides. None of them could ever rank, because the page
 * they land on renders no markup. The one region with a real page, teryt1261,
 * is reachable from the homepage and from the explore table, so dropping the
 * type here does not hide it.
 *
 * `place` was absent for the same reason until 2026-08-26, when companies got
 * their page back, and then stayed absent because putting the URLs in was a
 * decision nobody had taken. The Search Console export of 2026-09-10 took it:
 * over the preceding three months 554 `/instytucja/` URLs drew 4,903
 * impressions - 42% of the site's total, more than person and article pages
 * together - entirely on Google's own discovery, with no sitemap entry behind
 * any of them. Whatever share of the other ~3,860 published companies would
 * rank the same way was being left on the table.
 */
const SITEMAP_NODE_TYPES: readonly NodeType[] = ["person", "article", "place"];

/** Six hours because this reads every person and every article node - 4,919
 * documents a call, measured - and it is crawlers that ask for it. Uncached it
 * was 118,055 Firestore reads in 28 hours across 24 requests, 6% of everything
 * the site read, to answer a question whose answer changes when somebody
 * publishes a page and at no other time.
 *
 * `fetchNodes` has an hour-long cache of its own, but only per Cloud Run
 * instance, and a sitemap fetch is exactly the request most likely to land on
 * a cold one.
 *
 * `<lastmod>` added nothing to that bill, and that is a choice about where the
 * work happens rather than luck. Every way of computing the date here has to
 * learn which relations touch which page, and the cheapest honest version of
 * that is a sweep of `edges`: 49,583 documents, which at the measured 13.14
 * handler misses a day is 651,662 reads a day - a third again of everything the
 * site reads - and 47.5 MiB of heap on an instance already running 737-972 MiB
 * against a 1,024 MiB cap. It would also be the slowest thing here, and the
 * failure mode is not a slow sitemap: a source that misses the module's 5 s
 * timeout yields an *empty* sitemap, served 200 and cached. So the date is
 * written where the change happens, by whoever makes it, and this handler only
 * reads a field off a document it was already reading. See shared/lastmod.ts. */
export default defineCachedEventHandler(
  async () => {
    const urls: { loc: string; lastmod?: string }[] = [];

    const nodesSnapshots = await Promise.all(
      SITEMAP_NODE_TYPES.map((type) => fetchNodes(type)),
    );

    nodesSnapshots.forEach((nodesSnapshot) => {
      Object.entries(nodesSnapshot).forEach(([id, data]) => {
        if (pageIsPublic(data) && data.name) {
          if (SITEMAP_NODE_TYPES.includes(data.type)) {
            // Omitted rather than guessed where there is nothing to say: the
            // module keeps the url and drops the element, and a url without a
            // `lastmod` is one Google schedules exactly as it did before.
            const lastmod = sitemapLastmod(data);
            urls.push({
              loc: generateEntityUrl(data.type, id, data.name),
              ...(lastmod ? { lastmod } : {}),
            });
          }
        }
      });
    });

    return urls;
  },
  {
    name: "sitemap-urls",
    maxAge: 21600,
    swr: true,
  },
);
