import { expect, type Page } from "@playwright/test";

/** Get a page ready for a shot of one element, after the clicks that set it
 * up: the pointer is taken off whatever it was left over (a hover tint), a
 * row that just opened has to finish its transition (see `readyForFullPage`),
 * and the fonts have to be in. */
export async function readyForElementShot(page: Page) {
  await page.mouse.move(0, 0);
  await expect(
    page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}
