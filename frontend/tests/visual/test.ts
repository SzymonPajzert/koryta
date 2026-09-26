import { test as base, expect } from "@playwright/test";
import { pageTag, routeName, taggedPages } from "./pageTags";

type Router = {
  currentRoute: { value: { name?: unknown } };
  getRoutes: () => { name?: unknown }[];
};

/** Playwright's `test`, for the visual specs. It adds one check after every
 * test tagged `@page:` (see ./pageTags.ts): the route the app is showing
 * is the page the tag names.
 *
 * Run after the test body rather than before the capture, because that is the
 * only hook there is, and every spec here captures last or nearly last.
 * Skipped and failed tests are left alone: a skipped one never opened
 * anything, and a failed one already says what went wrong. */
export const test = base.extend<{ photographedPage: undefined }>({
  photographedPage: [
    async ({ page }, use, testInfo) => {
      await use(undefined);
      const declared = taggedPages(testInfo.tags);
      if (declared.length === 0 || testInfo.status !== "passed") return;

      // Read from the Vue app Nuxt mounts on #__nuxt. Vue sets `__vue_app__`
      // there in production builds too, for devtools, so this works against
      // the `dev:build` preview the suite runs on.
      const route = await page.evaluate(() => {
        const root = document.querySelector("#__nuxt") as
          | (Element & {
              __vue_app__?: {
                config: { globalProperties: { $router?: Router } };
              };
            })
          | null;
        const router = root?.__vue_app__?.config.globalProperties.$router;
        if (!router) return null;
        return {
          name: String(router.currentRoute.value.name ?? ""),
          names: router.getRoutes().map((r) => String(r.name ?? "")),
        };
      });

      expect(
        route,
        "no Nuxt router on the page at the end of the test",
      ).not.toBeNull();
      for (const file of declared) {
        expect(
          route!.names,
          `no route is named "${routeName(file)}", which is what ` +
            `routeName() in tests/visual/pageTags.ts makes of "${file}": either ` +
            `the tag names a page that does not exist, or Nuxt now names routes ` +
            `differently and routeName() has to follow`,
        ).toContain(routeName(file));
      }
      expect(
        declared.map(routeName),
        `the test is tagged ${declared.map(pageTag).join(", ")}, but ended ` +
          `on the route "${route!.name}" (${page.url()}) - so its screenshot ` +
          `is of some other page`,
      ).toContain(route!.name);
    },
    { auto: true },
  ],
});

export { expect };
