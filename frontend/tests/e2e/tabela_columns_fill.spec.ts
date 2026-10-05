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
});
