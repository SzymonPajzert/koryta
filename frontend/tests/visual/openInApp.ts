import type { Page } from "@playwright/test";

type MountPoint = Element & {
  __vue_app__?: {
    config: {
      globalProperties: { $router: { push: (to: string) => unknown } };
    };
  };
};

/** Opens `path` by a client-side navigation from another page, so what the
 * page fetches is fetched in the browser, where a test's route handler can
 * answer it. A plain `goto` server renders the page, and the server's fetches
 * never reach the handler. */
export async function openInApp(page: Page, path: string) {
  await page.goto("/o-nas");
  await page.waitForFunction(
    () =>
      !!(document.querySelector("#__nuxt") as MountPoint | null)?.__vue_app__,
  );
  await page.evaluate(async (to) => {
    const root = document.querySelector("#__nuxt") as MountPoint;
    await root.__vue_app__!.config.globalProperties.$router.push(to);
  }, path);
  await page.waitForURL(`**${path}`);
}
