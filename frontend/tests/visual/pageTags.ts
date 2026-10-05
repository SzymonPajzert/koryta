/** Which page a visual test photographs.
 *
 * A test says so with a tag: `@page:` and the page's file under app/pages,
 * without the extension.
 *
 *   test("opinie", { tag: "@page:admin/opinie" }, async ({ page }) => { … });
 *
 * Two things read it. tests/visualCoverage.test.ts fails for any page that no
 * test names, and runs with the unit tests, so a new page without a picture is
 * caught by quick-check rather than by nobody. `test` in ./test.ts checks,
 * after every tagged test, that the page on screen really is the one named, so
 * a tag cannot claim a page the test never reached - a sign in that bounced to
 * /login photographs the login form, and would otherwise bank it as a
 * baseline.
 *
 * The tag also filters: `--grep @page:admin/opinie` runs every capture of that
 * page. */

const PREFIX = "page:";

export const pageTag = (page: string) => `@${PREFIX}${page}`;

/** The pages a test's tags name. Playwright hands a running test its tags with
 * the `@`, and its JSON reporter hands them out without it, so both are read. */
export const taggedPages = (tags: readonly string[]) =>
  tags
    .map((tag) => tag.replace(/^@/, ""))
    .filter((tag) => tag.startsWith(PREFIX))
    .map((tag) => tag.slice(PREFIX.length));

/** The name Nuxt gives a page's route, which is all the router in the browser
 * knows it by: the path with each `[param]` reduced to the param's name, a
 * trailing `index` dropped, and `/` turned into `-`. `admin/rewizje/[id]` is
 * `admin-rewizje-id`, `[seoType]/[slug]` is `seoType-slug`, and `index` alone
 * stays `index`. Mirrors generateRoutesFromFiles in nuxt/src/pages/utils.ts;
 * ./test.ts fails loudly if the two ever disagree. */
export const routeName = (page: string) =>
  page
    .replace(/\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}/g, "$1")
    .replace(/\/index$/, "")
    .replaceAll("/", "-");
