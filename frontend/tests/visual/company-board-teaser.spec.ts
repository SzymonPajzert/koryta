import { test, expect } from "./test";
import { freezeClock } from "./clock";
import { readyForFullPage } from "./fullPage";
import { companyBoard } from "./fixtures/companyBoard";
import { openInApp } from "./openInApp";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** A company's „Obecny skład” as a logged out reader finds it: the whole
 * board, unpublished holders too, and where one of them has a party on record
 * the „???” chip in its place, with the sign-in banner
 * under the board. Szymon picked the spelled-out chip on 2026-10-24.
 *
 * Reached by a client-side navigation, so the board is fetched in the browser
 * where the route handler can answer it - see ./fixtures/companyBoard.ts for
 * why it has to be. The rest of the page is the seeded company's own. */

const COMPANY_URL = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";

test(
  "instytucja-sklad-mozliwe-powiazania",
  { tag: pageTag("[seoType]/[slug]") },
  async ({ page }, testInfo) => {
    await freezeClock(page);
    await page.route(
      (url) => url.pathname === "/api/edges/successions",
      (route) => route.fulfill({ json: companyBoard }),
    );
    await openInApp(page, COMPANY_URL);

    // What only the fixture says, so a run that drew the seeded board instead
    // fails here rather than banking it.
    const board = page.getByTestId("successions-current");
    await expect(board).toBeVisible({ timeout: 30_000 });
    await expect(board).toContainText("Krzysztof Stanisław Wielkopolański");
    const chips = board.getByTestId("party-locked");
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toHaveText("???");
    const banner = board.getByTestId("current-party-teaser");
    await expect(banner).toContainText("Przy 2 osobach z obecnego składu");

    // Both buttons inside the banner, side by side, on a phone too.
    const box = await banner.boundingBox();
    for (const testid of ["login-banner-login", "login-banner-signup"]) {
      const button = await banner.getByTestId(testid).boundingBox();
      expect(button!.x + button!.width, testid).toBeLessThanOrEqual(
        box!.x + box!.width,
      );
    }

    // One full-page shot cut to the board, at the window the project gives
    // - on a phone the board is taller than the screen. A shot of the element
    // itself scrolls the window down it and stitches the pieces, and laid the
    // fixed app bar across the board's top. A full-page shot draws the bar
    // once, at the top of the page, above where the board starts.
    await page.mouse.move(0, 0);
    await readyForFullPage(page);
    const clip = await board.boundingBox();
    await expect(page).toHaveScreenshot(
      "instytucja-sklad-mozliwe-powiazania.png",
      { fullPage: true, clip: clip! },
    );

    await expectFitsThePhone(page, testInfo);
  },
);
