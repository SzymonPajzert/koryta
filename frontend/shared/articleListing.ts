import { sourceHost } from "./articleTitle";

/** Article pages that stay on the site but are not offered to search engines.
 *
 * A post or a profile on a social network is often the only place a person's
 * job or party is stated, so it stays a source and keeps its page: readers
 * reach it from the person or company it is filed under. What it does not earn
 * is a place in Google. On 2026-11-09 the 85 sitemap articles from these sites
 * drew 179 impressions and 3 clicks from 2026-09-01 (Facebook 46 pages, 161
 * impressions and 2 clicks; LinkedIn 27, 18 and 1; X, YouTube and Instagram 12,
 * none), and Search Console showed them under titles like "Strona z
 * linkedin.com". Their pages show the source's address and who it is filed
 * under, and nothing a search result could promise.
 *
 * Szymon, 2026-11-11: an article with a single relation is still worth
 * listing and so is a BIP source, but sites like LinkedIn and Facebook go on an
 * ignore list, left out of the sitemap and marked noindex. Hence a list of
 * sites rather than a count of relations: by relations, 545 of the 902 listed
 * articles showed a logged-out reader nobody at all, among them the BIP pages
 * that bring the most searches per page.
 *
 * One test decides both halves, `inSitemap` (shared/lastmod.ts) and the
 * `noindex, follow` of app/components/article/DetailView.vue, so no page is
 * listed in the sitemap and marked noindex at once. `follow`: the links on the
 * page, to the people and companies it is filed under, still count.
 *
 * One cost: /api/nodes/[id]/url, which sends a link whose id was mangled (case,
 * a trailing full stop) on to its page, searches the sitemap's list, so such a
 * link to one of these pages answers 404 instead.
 */
export const UNLISTED_SOURCE_SITES: readonly string[] = [
  "facebook.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "threads.net",
];

/** Whether an address is on one of those sites, or on a subdomain of one
 * (pl.linkedin.com, m.facebook.com). */
export function isUnlistedSourceUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  const host = sourceHost(url);
  if (!host) return false;
  return UNLISTED_SOURCE_SITES.some(
    (site) => host === site || host.endsWith(`.${site}`),
  );
}

/** Whether a page may be offered to search engines as far as its source goes:
 * false only for an article whose source is on one of those sites. */
export function isListedSource(node: {
  type?: unknown;
  sourceURL?: unknown;
}): boolean {
  return !(node.type === "article" && isUnlistedSourceUrl(node.sourceURL));
}
