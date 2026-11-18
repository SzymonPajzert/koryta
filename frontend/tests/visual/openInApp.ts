import type { Page } from "@playwright/test";

type MountPoint = Element & {
  __vue_app__?: {
    config: {
      globalProperties: {
        $router: { push: (to: string) => Promise<unknown> };
        $nuxt?: {
          isHydrating?: boolean;
          hooks: { hookOnce: (name: string, run: () => void) => void };
        };
      };
    };
  };
};

/** Opens `path` by a client-side navigation from another page, so what the
 * page fetches is fetched in the browser, where a test's route handler can
 * answer it. A plain `goto` server renders the page, and the server's fetches
 * never reach the handler.
 *
 * Returns once Nuxt has scrolled the new page to the top, which it does a
 * frame after page:loading:end, smoothly (app.vue), and late for a page
 * pushed while /o-nas still hydrates. A test that scrolls down to point at
 * something before then has the page glide away from under the pointer. */
export async function openInApp(page: Page, path: string) {
  await page.goto("/o-nas");
  await page.waitForFunction(
    () =>
      (document.querySelector("#__nuxt") as MountPoint | null)?.__vue_app__
        ?.config.globalProperties.$nuxt?.isHydrating === false,
  );
  await page.evaluate(async (to) => {
    const root = document.querySelector("#__nuxt") as MountPoint;
    const { $router, $nuxt } = root.__vue_app__!.config.globalProperties;
    // Hooked before the push, so this runs ahead of the hook Nuxt's scroll
    // waits on: its frame comes first, and the second one after its scroll.
    const scrolled = new Promise<void>((resolve) =>
      $nuxt!.hooks.hookOnce("page:loading:end", () =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
    await $router.push(to);
    await scrolled;
  }, path);
  await page.waitForURL(`**${path}`);
}
