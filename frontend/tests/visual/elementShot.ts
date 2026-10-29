import { expect, type Page } from "@playwright/test";

/** Get a page ready for a shot of one element, after the clicks that set it
 * up: the element alone, with nothing of the page's chrome drawn over it.
 *
 * An element taller than the window is captured the way a full page is, with
 * each `position: fixed` element drawn once wherever the window was - so the
 * app bar came out across the element's top edge, and the feedback launcher
 * over whatever ended at its corner. The bar is put back in the flow of the
 * page, at its top, where it covers nothing below it; the launcher is hidden.
 *
 * And nothing may still be moving: the pointer is taken off whatever it was
 * left over (a hover tint), a row that just opened has to finish its
 * transition (see `readyForFullPage`), and the fonts have to be in. */
export async function readyForElementShot(page: Page) {
  await page.addStyleTag({
    content: [
      ".v-app-bar { position: absolute !important; }",
      ".feedback-fab { visibility: hidden !important; }",
    ].join("\n"),
  });
  await page.mouse.move(0, 0);
  await expect(
    page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}
