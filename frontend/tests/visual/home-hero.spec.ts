import { test, expect } from "./test";
import { readyForElementShot } from "./elementShot";
import { pageTag } from "./pageTags";

/** The home page's green band on its own: the sentence, the search and
 * „Działaj z nami” on a phone, the logo, the headline, the search and the
 * button on a desktop.
 *
 * `home.png` has the band too, but as the top of a 3,000px page whose feed
 * moves with the calendar, where a button 8px off the search's edge - the
 * whole of why it was taken off phones in August - is lost. This is the shot
 * that would show it coming back.
 */
test("strona-glowna-pasek", { tag: pageTag("index") }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/", { waitUntil: "load" });

  const hero = page.getByTestId("home-hero");
  await expect(hero.getByTestId("home-cta")).toBeVisible({ timeout: 60_000 });
  await readyForElementShot(page);

  await expect(hero).toHaveScreenshot("strona-glowna-pasek.png");
});
