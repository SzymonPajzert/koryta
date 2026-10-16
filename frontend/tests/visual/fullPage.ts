import { expect, type Page } from "@playwright/test";

/** Get a page ready for a `fullPage` shot, after the clicks that set it up.
 *
 * A full-page shot draws each `position: fixed` element once, wherever the
 * window was when it was taken. A click scrolls what it opens into view, which
 * on a phone takes the app bar off the top - a row opened below the fold came
 * out with a blank band where the bar belongs and the bar across the middle of
 * the list - so the window goes back to the top first ({@link backToTheTop}).
 * („Zgłoś” used to float over the page as well and had to be hidden; it is in
 * the bar now.)
 *
 * And nothing may still be opening. `v-expand-transition` holds a row's panel
 * at a whole number of pixels while it runs and only then lets it take its
 * real height, 538.4375px for the open row on /qa on a phone. A shot taken on
 * the wrong side of that came out a pixel short, along with everything below
 * the panel. `toBeVisible()` on the panel passes on the transition's first
 * frame, so this waits for Vue to take the transition's classes off. */
export async function readyForFullPage(page: Page) {
  await expect(
    page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
  ).toHaveCount(0);
  await backToTheTop(page);
  await page.evaluate(() => document.fonts.ready);
}

/** Put the window back at the top of the page, and wait for the app bar to
 * know it is there.
 *
 * At once, not in the glide the site's `scroll-behavior: smooth` makes of a
 * plain `scrollTo`: a shot taken during the glide drew the fixed bar part of
 * the way down the page, at a different height each run. But only once any
 * glide already under way has ended - a click's own `scrollIntoView`, as on
 * the phone's task map, which runs for some 45 frames: a jump in the middle of
 * it left the page 2px down. And the bar lifts itself with a shadow while the
 * page is scrolled (`scroll-behavior="elevate"`), dropping it only when
 * Vuetify's scroll listener sees the top, a frame after `scrollY` reads 0. */
export async function backToTheTop(page: Page) {
  await page.evaluate(async () => {
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    let last = -1;
    for (let still = 0; still < 10;) {
      await frame();
      still = window.scrollY === last ? still + 1 : 0;
      last = window.scrollY;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".v-app-bar:not(.v-toolbar--flat)")).toHaveCount(0);
}
