import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { WITH_CHROME } from "./chrome";

/** The chrome of app/layouts/default.vue on its own: the app bar signed out,
 * the bar with the strip for a signed-in admin, and the footer. Every other
 * test runs without it (./chrome.ts), so a change to a menu or to the footer
 * retakes these and the pages in ./pages.spec.ts with `chrome: true`.
 *
 * All on /crawler, which neither the bar nor the footer links to, so nothing
 * in them is lit. */

const PAGE = "/crawler";

const CHROME = { tag: WITH_CHROME };

const logo = (within: Locator) => within.getByAltText("Koryta.pl");

/** The footer's logo loads lazily, and on a phone it is below the window. */
async function pictureLoaded(img: Locator) {
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
}

/** The bar and the „Zgłoś” button are fixed, so where they land in the
 * footer's shot depends on the scroll. The `crawler` page shows the button
 * where it sits. */
async function hideFloatingChrome(page: Page) {
  await page.addStyleTag({
    content: ".v-app-bar, .feedback-fab { visibility: hidden !important; }",
  });
}

test("pasek", CHROME, async ({ page }) => {
  await page.goto(PAGE);
  const bar = page.locator(".v-app-bar");
  await pictureLoaded(logo(bar));

  await expect(bar).toHaveScreenshot("pasek.png");
});

/** The bar and the strip as one band from the top of the window, as a reader
 * only ever sees them together. An admin's strip has every button a strip can
 * have; anybody else's lacks „Admin”. */
test("pasek-zalogowany", CHROME, async ({ page }) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, PAGE);
  const strip = page.locator(".user-toolbar");
  await expect(strip.getByRole("button", { name: "Admin" })).toBeVisible({
    timeout: 30_000,
  });
  await pictureLoaded(logo(page.locator(".v-app-bar")));
  // Off the strip: the pointer is left where the sign-in button was.
  await page.mouse.move(0, 0);

  const box = await strip.boundingBox();
  expect(box, "the strip is not on the page").not.toBeNull();
  await expect(page).toHaveScreenshot("pasek-zalogowany.png", {
    clip: {
      x: 0,
      y: 0,
      width: page.viewportSize()!.width,
      height: box!.y + box!.height,
    },
  });
});

test("stopka", CHROME, async ({ page }) => {
  await page.goto(PAGE);
  const footer = page.locator(".v-main > .v-footer");
  await pictureLoaded(logo(footer));
  await hideFloatingChrome(page);

  await expect(footer).toHaveScreenshot("stopka.png");
});
