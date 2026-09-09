import { test, expect } from "@playwright/test";

/** The bar above the graph: the legend, and the controls that change what the
 * canvas says.
 *
 * Nothing else in the suite covers it. `instytucja-strona.png` does contain
 * this bar, but it is a full page shot whose last element is a force-directed
 * canvas that settles somewhere slightly different every run, so it is the
 * wrong instrument for a change to the bar - a legend row that stopped
 * rendering would be lost among the nodes that moved. The bar alone is
 * deterministic: no simulation, no dates, no counts.
 *
 * What it is here to catch, all of it added or removed recently and none of it
 * previously photographed:
 *   - the node legend, which stands on the bar with nothing to fold it away
 *     (the "Ukryj legendę" button used to sit to its left);
 *   - the edge legend, which names what a dashed line means - a reader wrote
 *     in to ask, and it renders only when the canvas is actually drawing those
 *     kinds, so a shot of an empty graph would prove nothing;
 *   - "Opisy powiązań", off by default, which writes the relation along each
 *     line when it is on.
 *
 * Desktop only. Below sm the company page keeps its graph behind a "Graf
 * połączeń" button, so there is no bar on a phone to photograph.
 */

/** The company the seed gives a full board, a seat and an owner: employment
 * lines and a seat line on one canvas, which is what makes the edge legend
 * draw more than one row. */
const COMPANY = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";

test.describe("Graf - pasek", () => {
  test("graf-pasek", async ({ page }, testInfo) => {
    // In the body, the way pages.spec.ts does it: a describe-level `test.skip`
    // has to take the fixtures argument as a destructuring pattern, and the
    // empty one that needs is what eslint's no-empty-pattern rejects.
    test.skip(
      testInfo.project.name !== "visual-desktop",
      "the phone keeps the graph behind a button, so there is no bar",
    );
    test.setTimeout(120_000);
    await page.goto(COMPANY);

    const bar = page.locator("[data-testid='graph-panel'] .graph-panel__bar");
    await expect(bar).toBeVisible({ timeout: 30_000 });

    // Both legends, by the text only each can produce. The node one is drawn
    // from the nodes on the canvas and the edge one from its edges, so waiting
    // on both is what proves the graph has loaded rather than that its
    // container has - a bar captured before the local graph arrives carries
    // neither list and would bank an empty baseline that passes for ever.
    await expect(bar.getByText("Instytucja")).toBeVisible({ timeout: 30_000 });
    await expect(
      bar
        .locator("[data-testid='graph-edge-legend']")
        .getByText("Zatrudnienie"),
    ).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => document.fonts.ready);
    await expect(bar).toHaveScreenshot("graf-pasek.png");
  });

  test("graf-pasek-opisy", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "visual-desktop",
      "the phone keeps the graph behind a button, so there is no bar",
    );
    test.setTimeout(120_000);
    await page.goto(COMPANY);

    const bar = page.locator("[data-testid='graph-panel'] .graph-panel__bar");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar.getByText("Instytucja")).toBeVisible({ timeout: 30_000 });

    // The on state, which no baseline has ever held: the toggle defaults off,
    // so every other capture in the suite shows it unpressed.
    await bar.getByTestId("graph-edge-labels-toggle").click();
    await expect(bar.getByText("Ukryj opisy")).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => document.fonts.ready);
    await expect(bar).toHaveScreenshot("graf-pasek-opisy.png");
  });
});
