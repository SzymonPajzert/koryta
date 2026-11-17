import type { Page } from "@playwright/test";

/** The tag for a test whose shots keep the layout's chrome, which every other
 * visual test runs without (see `hideChrome`). ./chrome.spec.ts has it, and so
 * do the pages in ./pages.spec.ts with `chrome: true`. Each further one is a
 * shot that moves whenever the chrome does. */
export const WITH_CHROME = "@chrome";

/** The parts of app/layouts/default.vue that are the same on every page: the
 * app bar, the signed-in strip, the footer and the „Zgłoś” button. Left in,
 * a change to any of them moves every page shot.
 *
 * The footer is removed rather than blanked, since its height depends on what
 * it lists. The bar stays as an empty band: tests click it, and the page is
 * laid out under it. */
const CSS = `
.v-app-bar { opacity: 0 !important; }
.feedback-fab { visibility: hidden !important; }
.user-toolbar, .v-main > .v-footer { display: none !important; }
`;

/** Takes the chrome off every document the page opens from now on.
 *
 * For the whole test rather than only during the capture (a `stylePath` in
 * playwright.config.ts): a capture that changes the layout moves the page out
 * from under whatever was placed against it, such as an open menu, a tooltip
 * or a clip measured from the page. */
export async function hideChrome(page: Page) {
  await page.addInitScript((css) => {
    const add = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.documentElement.append(style);
    };
    // On a navigation this runs before the parser has made the root element,
    // whatever the types say, so the sheet goes in once it has.
    if (document.documentElement as HTMLElement | null) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
  }, CSS);
}
