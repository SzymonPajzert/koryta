/** Keeps the staging backend out of search engines.
 *
 * `autopush` is built from the same source as `prod` and reads the same
 * Firestore, so to a crawler it is a second copy of koryta.pl - and it said as
 * much: `x-robots-tag: index, follow` on every page and an indexable
 * robots.txt, because nothing in the site config tells the two builds apart
 * (apphosting.yaml is shared by both backends). In the 30 days to 2026-09-19
 * crawlers made 18,071 requests there, 23% of the whole Firestore read bill,
 * on a backend nobody reads.
 *
 * The build cannot know which backend it will run as, so this is decided at
 * runtime, from `K_SERVICE` - the Cloud Run service name, which is how
 * sentry.server.config.ts tells the backends apart too. `indexable: false` in
 * the per-request site config is what both halves of nuxt-robots read: the
 * robots.txt route answers `Disallow: /` and every page gets
 * `X-Robots-Tag: noindex, nofollow`. On `prod` the hook is never registered.
 */
export default defineNitroPlugin((nitro) => {
  if (process.env.K_SERVICE !== "autopush") return;

  nitro.hooks.hook("site-config:init", ({ siteConfig }) => {
    siteConfig.push({
      _context: "autopush",
      // Above `runtime` (0), the highest priority the module assigns, so no
      // config or `NUXT_SITE_*` variable can switch indexing back on.
      _priority: 1,
      indexable: false,
    });
  });
});
