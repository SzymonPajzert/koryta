import { test, expect } from "@playwright/test";

/** „Kolumny są teraz pełne pustej przestrzeni, bo chipy mają ograniczoną
 * szerokość”, as something a test can hold: once /eksploruj/tabela took the
 * whole window, the table handed its columns more than their cells' caps asked
 * for, and the cells stopped at the caps - „Firmy” 526px wide at 1680 with its
 * chips cut off at 300 and the rest of the column empty.
 *
 * Measured rather than screenshotted, as tabela_phone.spec.ts and
 * nowe_table_fits.spec.ts are: the number is the complaint, and no visual
 * baseline captures this table at this width.
 */
const WIDE = { width: 1680, height: 926 };

test.describe("the table on a wide screen", () => {
  test.use({ viewport: WIDE });

  test("fills its columns without asking for more width", async ({ page }) => {
    test.setTimeout(120000);
    // Filtered to a company, so every row has a company cell to measure - the
    // same query tabela_phone.spec.ts uses for the same reason.
    await page.goto("/eksploruj/tabela?place=chain-company", {
      waitUntil: "load",
    });
    await expect(
      page.locator("tbody tr:first-child .text-primary.cursor-pointer").first(),
    ).toBeVisible({ timeout: 60000 });

    const measured = await page.evaluate(() => {
      const row = document.querySelector("tbody tr")!;
      const cells = [".name-cell", ".companies-cell"].map((selector) => {
        const cell = row.querySelector(selector) as HTMLElement;
        const td = cell.closest("td") as HTMLElement;
        const style = getComputedStyle(td);
        return {
          selector,
          column: Math.round(
            td.clientWidth -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight),
          ),
          cell: Math.round(cell.getBoundingClientRect().width),
        };
      });
      return {
        cells,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    for (const { selector, column, cell } of measured.cells) {
      expect(
        cell,
        `${selector} in a ${column}px column`,
      ).toBeGreaterThanOrEqual(column - 1);
    }

    // The caps are still what the columns are measured by, so filling them
    // must not have made the table any wider than the window.
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth);
  });

  /** „Może być wyśrodkowana po prostu a nie z lewej strony” - the report's
   * second round. Filling the cells could not help a column two and a half
   * times as wide as anything in it, which is what the whole window made of
   * every column at 2844px. The page is the layout's 1200px column now,
   * centred, and the query bar spans exactly the table under it.
   *
   * The scrim is the reason the page caps its own column rather than dropping
   * `fullWidth`: it is `position: absolute` against the layout's container,
   * and a 1200px container dimmed a 1200px strip with the sides left white. */
  test("sits in the middle of the window, its drawer dimming all of it", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto("/eksploruj/tabela?place=chain-company", {
      waitUntil: "load",
    });
    const firstName = page
      .locator("tbody tr:first-child .text-primary.cursor-pointer")
      .first();
    await expect(firstName).toBeVisible({ timeout: 60000 });

    const box = (selector: string) =>
      page.evaluate((selector) => {
        const { left, right } = document
          .querySelector(selector)!
          .getBoundingClientRect();
        return {
          left: Math.round(left),
          right: Math.round(right),
          window: document.documentElement.clientWidth,
        };
      }, selector);

    const card = await box(".table-card");
    // 1200px less the page's own 16px on either side.
    expect(card.right - card.left).toBe(1168);
    expect(
      Math.abs(card.left - (card.window - card.right)),
    ).toBeLessThanOrEqual(1);
    const bar = await box("[data-testid=tabela-query-bar]");
    expect([bar.left, bar.right]).toEqual([card.left, card.right]);

    await firstName.click();
    await expect(page.locator(".v-navigation-drawer--active")).toBeVisible();
    const scrim = await box(".v-navigation-drawer__scrim");
    expect([scrim.left, scrim.right]).toEqual([0, scrim.window]);
  });
});
