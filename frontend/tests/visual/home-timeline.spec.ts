import { test, expect } from "./test";
import { readyForElementShot } from "./elementShot";
import { pageTag } from "./pageTags";
import { homeTimelineFixture } from "./fixtures/homeTimeline";

/** The home chart „Stanowiska” under „Województwa”, with its tooltip open on
 * the newest month. The rows stand as the lines do there, so „Pozostałe
 * województwa”, the highest line and the last series, heads the list.
 *
 * The chart's data is a fixture (fixtures/homeTimeline.ts). The panel is
 * opened by a click, not by /?widok=stanowiska: then the browser asks for the
 * data and the route below answers, where a panel the server renders fetches
 * it on the server, out of the route's reach. */
test("home-timeline-tooltip", { tag: pageTag("index") }, async ({ page }) => {
  await page.route("**/api/stats/homeTimeline**", (route) =>
    route.fulfill({ json: homeTimelineFixture() }),
  );
  await page.goto("/");
  // Both breakpoints draw a strip; only one is shown at a time.
  await page
    .locator(".v-tab:visible", { hasText: "Stanowiska" })
    .first()
    .click();
  const card = page.getByTestId("home-timeline");
  await expect(card.locator(".apexcharts-svg")).toHaveCount(1);
  await page
    .getByTestId("home-timeline-grouping")
    .locator(".v-radio")
    .filter({ has: page.getByText("Województwa", { exact: true }) })
    .click();
  await expect(card.getByText("Województwa", { exact: true })).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await readyForElementShot(page);

  // The newest month is the plot's right edge. Half a pixel in: on a phone a
  // month is under 2px wide, and a whole pixel in reached the month before.
  const plot = await card
    .locator(".apexcharts-gridlines-horizontal, .apexcharts-grid")
    .first()
    .boundingBox();
  await page.mouse.move(
    plot!.x + plot!.width - 0.5,
    plot!.y + plot!.height / 2,
  );
  await expect(card.locator(".apexcharts-tooltip-title")).toHaveText(
    "Listopad 2026",
  );
  await expect(card).toHaveScreenshot("home-timeline-tooltip.png");
});
