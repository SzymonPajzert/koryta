import { test, expect } from "./test";
import { readyForElementShot } from "./elementShot";
import { pageTag } from "./pageTags";

/** The home explorer's third panel, „Oświadczenia”: the people published out
 * of everybody a declaration can publish, the bar, the namesakes apart and the
 * people published a day, with what is under way in the right-hand column.
 * Drawn from the night's count the seed writes (scripts/declarationPeople.ts).
 *
 * Opened by a click, as a reader opens it: an automated browser sits the
 * home-default split out (app/composables/experiments.ts), so the page always
 * lands on the map here, and `home.png` keeps showing that. */
test("home-oswiadczenia", { tag: pageTag("index") }, async ({ page }) => {
  await page.goto("/");
  // Both breakpoints draw a strip; only one is shown at a time.
  await page
    .locator(".v-tab:visible", { hasText: "Oświadczenia" })
    .first()
    .click();
  const panel = page.getByTestId("people-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".apexcharts-svg")).toHaveCount(1);
  await expect(page.getByTestId("people-side")).toBeVisible();
  await readyForElementShot(page);
  await expect(page.getByTestId("home-explorer")).toHaveScreenshot(
    "home-oswiadczenia.png",
  );
});
