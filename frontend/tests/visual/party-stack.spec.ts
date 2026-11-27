import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { readyForElementShot } from "./elementShot";
import { pageTag } from "./pageTags";
import { partyStackFixture } from "./fixtures/partyStack";

/** „Partie w czasie” on /eksploruj/autograf, cut to hospitals and narrowed to
 * 2018-2026: the category picker and the year slider in one row, and the
 * stack of party bands under them (fixtures/partyStack.ts).
 *
 * A plain `goto` is enough: the page draws behind `<ClientOnly>`, so the
 * browser asks for the data and the route below answers. */

const AUTOGRAF = { tag: pageTag("eksploruj/autograf/[type]") };

async function openHospitals(page: Page) {
  await page.route("**/api/stats/partyStack**", (route) =>
    route.fulfill({ json: partyStackFixture() }),
  );
  await page.goto(
    "/eksploruj/autograf/partie-w-czasie?kategoria=szpitale&od=2018&do=2026",
  );
  const panel = page.getByTestId("party-stack-panel");
  await expect(
    panel.getByText("Stanowiska wg partii: Szpitale", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator(".apexcharts-svg")).toHaveCount(1);
  await expect(panel.getByTestId("party-stack-years-shown")).toHaveText(
    "2018 - 2026",
  );
  return panel;
}

test("partie-w-czasie", AUTOGRAF, async ({ page }) => {
  const panel = await openHospitals(page);
  // The select's outlined label sits half above its border, out of the
  // panel's box, where an element shot would cut it in two. On the page the
  // gap above the panel holds it; here the panel makes room of its own.
  await page.addStyleTag({
    content: '[data-testid="party-stack-panel"] { padding-top: 12px; }',
  });
  await panel.scrollIntoViewIfNeeded();
  await readyForElementShot(page);

  await expect(panel).toHaveScreenshot("partie-w-czasie.png");
});

/** The tooltip on the newest month: the bands top down as they stand, each
 * with its share, and the month's people in the title. */
test("partie-w-czasie-dymek", AUTOGRAF, async ({ page }) => {
  const panel = await openHospitals(page);
  const card = panel.getByTestId("party-stack");
  await card.scrollIntoViewIfNeeded();
  await readyForElementShot(page);

  // The newest month is the plot's right edge, half a pixel in, moved to
  // again until the tooltip names it - the chart can miss a move. As in
  // home-timeline.spec.ts.
  const plotArea = card
    .locator(".apexcharts-gridlines-horizontal, .apexcharts-grid")
    .first();
  const title = card.locator(".apexcharts-tooltip-title");
  await expect(async () => {
    const plot = (await plotArea.boundingBox())!;
    const edge = plot.x + plot.width - 0.5;
    const middle = plot.y + plot.height / 2;
    await page.mouse.move(edge - 4, middle);
    await page.mouse.move(edge, middle);
    await expect(title).toHaveText(/^Listopad 2026: /, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await expect(card).toHaveScreenshot("partie-w-czasie-dymek.png");
});
