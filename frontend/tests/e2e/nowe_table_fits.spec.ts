import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** "The eksploruj table now is spilling to the right on the card", as something
 * a test can hold.
 *
 * The page had copied /eksploruj/tabela's `overflow: visible` on everything
 * between the sticky `<th>` and the page, without copying the second half of
 * that trick - the unscoped `html.tabela-scroll-x { overflow-x: auto }` that
 * gives the overflow somewhere to go. So the table laid itself out at the sum
 * of its eleven columns and painted straight out over the page background past
 * the card's right edge, which is what the reporter saw on a 2844px screen. At
 * 1280 the same overhang went behind Vuetify's `html { overflow-x: hidden }`
 * instead and simply swallowed the last three columns - the vote control and
 * the "Eksploruj" button among them, which are steps 3 and 1 of this page's
 * own three.
 *
 * Measured rather than screenshotted, for the same reason
 * tests/e2e/tabela_phone.spec.ts measures: the number is the complaint. No
 * visual baseline captures this table at any width, which is how a 350px spill
 * shipped in the first place.
 */
test.describe("the queue table stays inside its card", () => {
  test("does not paint past the card, and keeps every column reachable", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await logIn(page, USERS.normal, "/eksploruj/nowe");

    await expect(
      page.locator(".table-card tbody tr:first-child .text-primary").first(),
    ).toBeVisible({ timeout: 60000 });

    const box = await page.evaluate(() => {
      const card = document.querySelector(".table-card") as HTMLElement;
      const table = card.querySelector("table") as HTMLElement;
      const wrapper = card.querySelector(".v-table__wrapper") as HTMLElement;
      return {
        tableRight: Math.round(table.getBoundingClientRect().right),
        cardRight: Math.round(card.getBoundingClientRect().right),
        wrapperScroll: wrapper.scrollWidth,
        wrapperClient: wrapper.clientWidth,
        viewport: document.documentElement.clientWidth,
      };
    });

    // The card clips again, so even a table wider than its column budget
    // cannot escape it.
    expect(box.tableRight).toBeLessThanOrEqual(box.cardRight + 1);
    expect(box.cardRight).toBeLessThanOrEqual(box.viewport);

    // And with five columns instead of eleven it does not need clipping: the
    // wrapper has nothing to scroll. If this one goes red the next column to
    // cut is "Lata pracy" - a derived total whose every constituent job is in
    // "Historia powiązań" below the table. What must not happen is putting the
    // overflow rule back to make it pass; that rule is the bug.
    expect(box.wrapperScroll).toBeLessThanOrEqual(box.wrapperClient);

    // "Eksploruj" is the last control in the row and was the first thing over
    // the edge - step 1 of the three the page asks for.
    const explore = page
      .locator(".table-card tbody tr")
      .first()
      .locator("button")
      .last();
    await expect(explore).toBeVisible();
    const rect = await explore.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(box.viewport);
  });
});
