import { test, expect } from "./test";
import { freezeClock } from "./clock";
import { companyBoard } from "./fixtures/companyBoard";
import { openInApp } from "./openInApp";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** A company's „Obecny skład” as a logged out reader finds it: the whole
 * board, unpublished holders too, and where one of them has a party on record
 * the grey „możliwe powiązania” chip in its place, with the sign-in banner
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
    await expect(chips.first()).toHaveText("możliwe powiązania");
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

    // The whole board inside one window, so the shot is not stitched
    // together under the app bar, which a phone's 812px would lay across
    // the top of it.
    const { width } = page.viewportSize()!;
    await page.setViewportSize({ width, height: 2000 });
    await page.mouse.move(0, 0);
    await page.addStyleTag({
      content: ".feedback-fab { visibility: hidden !important; }",
    });
    await page.evaluate(() => document.fonts.ready);
    await expect(board).toHaveScreenshot(
      "instytucja-sklad-mozliwe-powiazania.png",
    );

    await expectFitsThePhone(page, testInfo);
  },
);
