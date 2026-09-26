import { expect, type Page } from "@playwright/test";

/** Get a page ready for a `fullPage` shot, after the clicks that set it up.
 *
 * A full-page shot draws each `position: fixed` element once, wherever the
 * window was when it was taken. The feedback launcher would land on top of
 * whichever row the first window ended at, so it is hidden. And a click scrolls
 * what it opens into view, which on a phone takes the app bar off the top -
 * a row opened below the fold came out with a blank band where the bar
 * belongs and the bar across the middle of the list - so the window goes back
 * to the top first.
 *
 * And nothing may still be opening. `v-expand-transition` holds a row's panel
 * at a whole number of pixels while it runs and only then lets it take its
 * real height, 538.4375px for the open row on /qa on a phone. A shot taken on
 * the wrong side of that came out a pixel short, along with everything below
 * the panel. `toBeVisible()` on the panel passes on the transition's first
 * frame, so this waits for Vue to take the transition's classes off. */
export async function readyForFullPage(page: Page) {
  await page.addStyleTag({
    content: ".feedback-fab { visibility: hidden !important; }",
  });
  await expect(
    page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
  ).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
}
