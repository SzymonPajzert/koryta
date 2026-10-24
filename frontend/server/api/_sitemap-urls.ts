import { generateEntityUrl } from "~~/app/composables/slugs";
import {
  SITEMAP_NODE_TYPES,
  inSitemap,
  sitemapLastmod,
} from "~~/shared/lastmod";
import { listedPosts } from "~~/shared/blog";
import { blogPosts } from "~~/server/utils/blog";

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
  async (event) => {
    const urls: { loc: string; lastmod?: string }[] = [];

    // Never a draft, not even from a local build: a sitemap only names pages
    // that are meant to be found.
    const posts = await blogPosts(event).all();
    for (const post of listedPosts(posts, { includeDrafts: false })) {
      urls.push({ loc: post.path, lastmod: post.date });
    }

    const nodesSnapshots = await Promise.all(
      SITEMAP_NODE_TYPES.map((type) => fetchNodes(type)),
    );

    nodesSnapshots.forEach((nodesSnapshot) => {
      Object.entries(nodesSnapshot).forEach(([id, data]) => {
        if (inSitemap(data)) {
          // Omitted rather than guessed where there is nothing to say: the
          // module keeps the url and drops the element, and a url without a
          // `lastmod` is one Google schedules exactly as it did before.
          const lastmod = sitemapLastmod(data);
          urls.push({
            loc: generateEntityUrl(data.type, id, data.name),
            ...(lastmod ? { lastmod } : {}),
          });
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
