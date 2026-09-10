import { generateEntityUrl } from "~~/app/composables/slugs";
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
 * a cold one. */
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
            urls.push({
              loc: generateEntityUrl(data.type, id, data.name),
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
