import { test, expect } from "./test";
import { readyForElementShot } from "./elementShot";
import { openInApp } from "./openInApp";
import { pageTag } from "./pageTags";
import { regionStatsFixture } from "./fixtures/regionStats";

/** The home map as picked on board rounds mapa-kolory-r1 and r2 (decision on
 * 2026-11-18): the party leading each powiat, shaded by its share, and one
 * party's share once its chip is picked. The counts are production's
 * (fixtures/regionStats.ts), answered in the browser: a server-rendered `/`
 * fetches them out of a route's reach, so the page is opened from another
 * with its payload refused. */
test.describe("home map", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/stats/regions**", (route) =>
      route.fulfill({ json: regionStatsFixture() }),
    );
    // `/` is swr, so a client-side visit takes its data from the page's
    // payload, rendered on the server. Without one the map fetches here.
    await page.route("**/_payload.json**", (route) => route.abort());
    await openInApp(page, "/?widok=mapa");
  });

  test("home-map", { tag: pageTag("index") }, async ({ page }) => {
    const map = page.locator(".poland-map-container");
    await expect(map.getByTestId("map-switch")).toBeVisible();
    await readyForElementShot(page);
    await expect(map).toHaveScreenshot("home-map.png");
  });

  test("home-map-party", { tag: pageTag("index") }, async ({ page }) => {
    const map = page.locator(".poland-map-container");
    await map.locator(".map-switch__chip", { hasText: "PiS" }).click();
    await expect(map.getByTestId("map-legend")).toContainText("Udział PiS");
    await readyForElementShot(page);
    await expect(map).toHaveScreenshot("home-map-party.png");
  });
});
