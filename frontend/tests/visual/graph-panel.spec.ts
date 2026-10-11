import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { pageTag } from "./pageTags";

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
 *   - "Opisy na liniach", off by default, which writes the relation along each
 *     line when its box is ticked - one label either way, so ticking it moves
 *     nothing on the bar.
 *
 * And on a phone, where the company page keeps its graph behind „Pokaż graf
 * powiązań”, so the shots there open it first. That is where the controls
 * break onto a second line: they need about 340px in one, and a phone gives
 * the bar 300 - unwrapped, „2 kroki” ran past its edge and was cut off.
 */

/** The company the seed gives a full board, a seat and an owner: employment
 * lines and a seat line on one canvas, which is what makes the edge legend
 * draw more than one row. */
const COMPANY = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";

/** The bar, over a graph that has loaded. On a phone the graph is opened with
 * „Pokaż graf powiązań” first - in a retry, because before hydration the click
 * lands on a button nothing listens to yet.
 *
 * The desktop is sent that button too: the server has no width to ask, so it
 * renders the page as a phone and hydration swaps the button for the graph. A
 * click that finds it just before then waits for a button that is gone, which
 * is why the click has a timeout of its own - the retry then finds the bar. */
async function openBar(page: Page) {
  await page.goto(COMPANY);

  const bar = page.locator("[data-testid='graph-panel'] .graph-panel__bar");
  const show = page.getByRole("button", { name: "Pokaż graf powiązań" });
  await expect(async () => {
    if (await show.isVisible()) await show.click({ timeout: 2_000 });
    await expect(bar).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // Both legends, by the text only each can produce. The node one is drawn
  // from the nodes on the canvas and the edge one from its edges, so waiting
  // on both is what proves the graph has loaded rather than that its
  // container has - a bar captured before the local graph arrives carries
  // neither list and would bank an empty baseline that passes for ever.
  await expect(bar.getByText("Instytucja")).toBeVisible({ timeout: 30_000 });
  await expect(
    bar.locator("[data-testid='graph-edge-legend']").getByText("Zatrudnienie"),
  ).toBeVisible({ timeout: 30_000 });

  // Fixed chrome, hidden rather than masked: the bar is scrolled into view to
  // be photographed, and on a phone that can put it under either of them.
  await page.addStyleTag({
    content: ".v-app-bar, .feedback-fab { visibility: hidden !important; }",
  });
  return bar;
}

test.describe("Graf - pasek", { tag: pageTag("[seoType]/[slug]") }, () => {
  test("graf-pasek", async ({ page }) => {
    test.setTimeout(120_000);
    const bar = await openBar(page);

    await page.evaluate(() => document.fonts.ready);
    await expect(bar).toHaveScreenshot("graf-pasek.png");
  });

  test("graf-pasek-opisy", async ({ page }) => {
    test.setTimeout(120_000);
    const bar = await openBar(page);

    // The on state, which no other baseline holds: the toggle defaults off,
    // so every other capture in the suite shows its box empty.
    const toggle = bar.getByTestId("graph-edge-labels-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });

    await page.evaluate(() => document.fonts.ready);
    await expect(bar).toHaveScreenshot("graf-pasek-opisy.png");
  });
});
