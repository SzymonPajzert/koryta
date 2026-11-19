import { test, expect } from "./test";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import { readingActivity } from "./fixtures/activityReadings";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** Scans read on /oswiadczenia on /eksploruj/statystyki, as round
 * oswiadczenia-statystyki-r4 approved it on 2026-11-19: ranked apart from the
 * changes, on the „Skany” tab that opens first, and drawn in a band of their
 * own under the changes' stack, on the same days and a scale of their own.
 *
 * The seed has no recent activity, so the answer comes from
 * ./fixtures/activityReadings.ts by route: the page fetches it in the
 * browser. */

const STATYSTYKI = { tag: pageTag("eksploruj/statystyki") };

test("statystyki-skany", STATYSTYKI, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await page.route("**/api/stats/activity**", (route) =>
    route.fulfill({ json: readingActivity }),
  );
  await page.goto("/eksploruj/statystyki");

  const ranking = page
    .locator(".v-card")
    .filter({ has: page.getByTestId("contributors-tabs") })
    .first();
  await expect(ranking.locator("tbody tr")).toHaveCount(10, {
    timeout: 30_000,
  });
  const timeline = page
    .locator(".v-card")
    .filter({ hasText: "Co się działo w bazie" })
    .first();
  await expect(timeline.locator(".apexcharts-canvas")).toHaveCount(2);

  await readyForElementShot(page);
  await expect(ranking).toHaveScreenshot("statystyki-skany.png");
  await expect(timeline).toHaveScreenshot("statystyki-skany-wykres.png");

  await page.getByTestId("contributors-tab-changes").click();
  await expect(ranking.locator("th", { hasText: "Razem" })).toBeVisible();
  await readyForElementShot(page);
  await expect(ranking).toHaveScreenshot("statystyki-zmiany.png");

  await expectFitsThePhone(page, testInfo);
});
