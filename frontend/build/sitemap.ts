import type { NitroConfig } from "nitropack";
import type { NodeType } from "../shared/model";

/** What a child sitemap is read from: the pages of one node type, or the blog.
 * Each is a route of server/api/_sitemap-urls/[source].ts. */
export type SitemapSource = NodeType | "blog";

/** The child sitemaps /sitemap.xml lists, by file name, and what each holds.
 *
 * One file per page type rather than one for the whole site, for two reasons.
 * Google decides per sitemap file whether its `<lastmod>` values are worth
 * believing (John Mueller, Search Off the Record 114, 2026-10-01), and the
 * dates here are not equally good: a person's moves when the page is
 * published or a relation on it is, while a company's also moves with every
 * change to its board, and on 2026-11-09 3,356 companies still shared a single
 * stamp. In one file the noisy dates cost the accurate ones their credit. The
 * second reason is Search Console: its Page indexing report can be filtered by
 * sitemap, which is the only place it gives indexed counts per page type.
 *
 * - `sitemap-osoby`: /osoba/... - published people (2,345 on 2026-11-09).
 * - `sitemap-instytucje`: /instytucja/... - published companies and
 *   institutions, node type `place` (10,628).
 * - `sitemap-artykuly`: /artykul/... - published articles (902).
 * - `sitemap-strony`: everything else - the static pages the module finds
 *   among app/pages, and the blog's published posts (16 together).
 *
 * Every type in SITEMAP_NODE_TYPES has exactly one file here; the test in
 * tests/build/sitemap.test.ts holds that, so a type added there cannot fall out
 * of every sitemap. A name must not end in "-<number>": the module reads that
 * as a chunk of a chunked sitemap. */
export const SITEMAP_FILES = {
  "sitemap-osoby": "person",
  "sitemap-instytucje": "place",
  "sitemap-artykuly": "article",
  "sitemap-strony": "blog",
} as const satisfies Record<string, SitemapSource>;

/** The internal route a child sitemap's urls come from. */
export function sitemapSourceUrl(source: SitemapSource): string {
  return `/api/_sitemap-urls/${source}`;
}

/** The `sitemap` options for @nuxtjs/sitemap: one child per `SITEMAP_FILES`
 * entry, each reading its own source.
 *
 * `includeAppSources` only on the blog's file, so the static pages land in
 * exactly one sitemap. They are what the module calls app sources (pages
 * without a parameter, route rules, prerendered routes); with `sitemaps` set a
 * child gets them only by asking.
 *
 * `sitemapsPathPrefix: "/"` puts the children at the site root
 * (/sitemap-osoby.xml) rather than under the module's default /__sitemap__/.
 * A sitemap covers only the urls below its own directory unless it was
 * submitted in Search Console (developers.google.com/search/docs/
 * crawling-indexing/sitemaps/build-sitemap), and a child named only by the
 * index, or found through robots.txt by another engine, is not obviously
 * that. At the root there is nothing to argue about. */
export function sitemapOptions(): {
  sitemapsPathPrefix: string;
  sitemaps: Record<string, ChildSitemap>;
} {
  return {
    sitemapsPathPrefix: "/",
    sitemaps: Object.fromEntries(
      Object.entries(SITEMAP_FILES).map(
        ([name, source]): [string, ChildSitemap] => [
          name,
          {
            sources: [sitemapSourceUrl(source)],
            ...(source === "blog" ? { includeAppSources: true } : {}),
          },
        ],
      ),
    ),
  };
}

type ChildSitemap = { sources: string[]; includeAppSources?: boolean };

const SITEMAP_XML = "/sitemap.xml";
const MODULE_INDEX = "/sitemap_index.xml";

type RobotsRuntimeConfig = { sitemap?: unknown };

/** Serve the sitemap index at /sitemap.xml itself, and name it there in
 * robots.txt. A `nitro:config` hook in nuxt.config.ts.
 *
 * With more than one sitemap, @nuxtjs/sitemap puts the index at
 * /sitemap_index.xml and turns /sitemap.xml into a 307 to it. But
 * http://koryta.pl/sitemap.xml is the sitemap registered in Search Console,
 * which Googlebot reads every two days or so, and Google's own description of
 * that report says of a sitemap's url: "The exact URL specified when the
 * sitemap was submitted. Redirects are not followed."
 * (support.google.com/webmasters/answer/7451001). Whatever Google does with a
 * redirected sitemap, a 200 at the address it already has asks nothing of it.
 * So the module's handler for /sitemap.xml is swapped for its index handler,
 * and the redirect rule goes. /sitemap_index.xml keeps answering with the same
 * index; nothing names it.
 *
 * robots.txt follows: the module adds its index path to the robots module's
 * list, and the Page indexing report offers every sitemap robots.txt names as
 * a filter of its own, so leaving it there would show the one index twice
 * under two names.
 *
 * Throws when the module stops registering either route, so that an upgrade
 * which changes them fails the build instead of quietly shipping the redirect.
 */
export function serveSitemapIndexAtSitemapXml(nitroConfig: NitroConfig): void {
  const handlers = nitroConfig.handlers ?? [];
  const index = handlers.find((handler) => handler?.route === MODULE_INDEX);
  const root = handlers.find((handler) => handler?.route === SITEMAP_XML);
  if (!index || !root) {
    throw new Error(
      `build/sitemap.ts: @nuxtjs/sitemap no longer registers both ${SITEMAP_XML} and ${MODULE_INDEX}. ` +
        `Check what ${SITEMAP_XML} serves before changing this.`,
    );
  }
  root.handler = index.handler;
  root.lazy = index.lazy;

  const rule = nitroConfig.routeRules?.[SITEMAP_XML];
  if (rule) delete rule.redirect;

  const runtime = nitroConfig.runtimeConfig as
    | (Record<string, unknown> & { public?: Record<string, unknown> })
    | undefined;
  for (const robots of [
    runtime?.["nuxt-robots"],
    runtime?.public?.["nuxt-robots"],
  ] as (RobotsRuntimeConfig | undefined)[]) {
    if (!robots || !Array.isArray(robots.sitemap)) continue;
    robots.sitemap = [
      ...new Set(
        (robots.sitemap as unknown[]).map((path) =>
          path === MODULE_INDEX ? SITEMAP_XML : path,
        ),
      ),
    ];
  }
}
