import type { H3Event } from "h3";
import { generateEntityUrl } from "~~/shared/slugs";
import {
  SITEMAP_NODE_TYPES,
  inSitemap,
  sitemapLastmod,
} from "~~/shared/lastmod";
import type { NodeType } from "~~/shared/model";
import { listedPosts } from "~~/shared/blog";
import { blogPosts } from "~~/server/utils/blog";

export type SitemapEntry = { loc: string; lastmod?: string };

/** The urls of one child sitemap: `/api/_sitemap-urls/<type>` for the pages of
 * one type in SITEMAP_NODE_TYPES, `/api/_sitemap-urls/blog` for the blog's
 * posts. Which file each goes into is build/sitemap.ts.
 *
 * One source per type rather than one for the whole site with the module's
 * `_sitemap` key routing each url, because a child then reads only its own
 * type. The Firestore bill is the same or lower: a crawler that fetches every
 * child reads each type once per cache miss, as the single source did, and one
 * that fetches only the people's file no longer pays for 10,000 companies. The
 * failure mode is the reason that matters. A source whose read fails yields an
 * *empty* sitemap, served 200 and cached for the module's ten minutes. A slow
 * one is only slow: the module's 5 s abort does not reach an internal source,
 * which it calls through Nitro's local fetch (measured on a build with no
 * Firestore: 91 s, then an empty urlset). One source for everything failed
 * every file at once; now a failed read empties only its own child.
 *
 * Six hours because this reads every node of a type - every person and every
 * article was 4,919 documents a call, measured - and it is crawlers that ask
 * for it. Uncached it was 118,055 Firestore reads in 28 hours across 24
 * requests, 6% of everything the site read, to answer a question whose answer
 * changes when somebody publishes a page and at no other time. The key is the
 * source alone, so a query string cannot make every request a cache miss.
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
 * slowest thing here is the one that empties a sitemap. So the date is written
 * where the change happens, by whoever makes it, and this handler only reads a
 * field off a document it was already reading. See shared/lastmod.ts. */
export default defineCachedEventHandler(
  async (event): Promise<SitemapEntry[]> => {
    const source = getRouterParam(event, "source");
    if (source === "blog") return blogUrls(event);
    if (isSitemapNodeType(source)) return nodeUrls(source);
    throw createError({
      statusCode: 404,
      message: `No sitemap source ${String(source)}`,
    });
  },
  {
    name: "sitemap-urls",
    maxAge: 21600,
    swr: true,
    getKey: (event) => getRouterParam(event, "source") ?? "",
  },
);

function isSitemapNodeType(source: string | undefined): source is NodeType {
  return (SITEMAP_NODE_TYPES as readonly (string | undefined)[]).includes(
    source,
  );
}

async function nodeUrls(type: NodeType): Promise<SitemapEntry[]> {
  const nodes = await fetchNodes(type);
  const urls: SitemapEntry[] = [];
  for (const [id, data] of Object.entries(nodes)) {
    if (!inSitemap(data)) continue;
    // Omitted rather than guessed where there is nothing to say: the module
    // keeps the url and drops the element, and a url without a `lastmod` is
    // one Google schedules exactly as it did before.
    const lastmod = sitemapLastmod(data);
    urls.push({
      loc: generateEntityUrl(data.type, id, data.name),
      ...(lastmod ? { lastmod } : {}),
    });
  }
  return urls;
}

async function blogUrls(event: H3Event): Promise<SitemapEntry[]> {
  // Never a draft, not even from a local build: a sitemap only names pages
  // that are meant to be found.
  const posts = await blogPosts(event).all();
  return listedPosts(posts, { includeDrafts: false }).map((post) => ({
    loc: post.path,
    lastmod: post.date,
  }));
}
