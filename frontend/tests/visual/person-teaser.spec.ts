import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { freezeClock } from "./clock";
import { personTeaser } from "./fixtures/personTeaser";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** A person nobody has published, as a logged out reader finds them: the name,
 * the latest post and the way to sign in, in place of „Dostęp zastrzeżony".
 *
 * Reached by a client-side navigation, so the teaser is fetched in the browser
 * where the route handler can answer it - see ./fixtures/personTeaser.ts for
 * why it has to be. The page itself is the real one: /api/nodes answers the
 * seeded draft with the 404 a logged out reader gets. */

const SLUG = { tag: pageTag("[seoType]/[slug]") };
const PATH = "/osoba/jan-przykladowy-h1";

type MountPoint = Element & {
  __vue_app__?: {
    config: {
      globalProperties: { $router: { push: (to: string) => unknown } };
    };
  };
};

async function openInApp(page: Page, path: string) {
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

test("osoba-niezweryfikowana", SLUG, async ({ page }, testInfo) => {
  await freezeClock(page);
  await page.route("**/api/nodes/h1/teaser", (route) =>
    route.fulfill({ json: personTeaser }),
  );
  await openInApp(page, PATH);

  // What only the fixture says, so a run that drew the wall instead fails
  // here rather than banking it.
  const teaser = page.getByTestId("person-teaser");
  await expect(teaser).toBeVisible({ timeout: 30_000 });
  await expect(teaser).toContainText("Członek Rady Nadzorczej");
  await expect(teaser).toContainText("wszystkie 4 stanowiska");

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("osoba-niezweryfikowana.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});
