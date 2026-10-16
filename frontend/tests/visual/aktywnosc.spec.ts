import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { activityFeed } from "./fixtures/activityFeed";
import { activityStats } from "./fixtures/activityStats";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /aktywnosc, what people did to the data this week, as an established
 * administrator reads it: the month's columns and the filters in the rail,
 * the week's lines under their days.
 *
 * The page is server rendered, but both the feed and the month are fetched in
 * the browser, with the reader's token, after the client-side navigation
 * `logIn` ends in - so a route handler answers them, from
 * ./fixtures/activityFeed.ts and ./fixtures/activityStats.ts, and the day
 * headings and times are counted from the frozen clock. */

const AKTYWNOSC = { tag: pageTag("aktywnosc") };

test("aktywnosc", AKTYWNOSC, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  // Only a GET is answered, as by the real routes. The week is enough lines
  // that the page does not widen itself to the month, so this is asked once.
  await page.route("**/api/activity/feed**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: activityFeed })
      : route.fulfill({ status: 404, json: { message: "Page not found" } }),
  );
  await page.route("**/api/stats/activity**", (route) => {
    const days = Number(
      new URL(route.request().url()).searchParams.get("days") ?? 30,
    );
    return route.fulfill({ json: activityStats(days) });
  });
  await logIn(page, USERS.admin, "/aktywnosc");

  // Every line but the reader's own, which the page hides as it opens - a
  // count only the fixture produces, so a run that drew the seed fails here.
  await expect(page.getByTestId("feed-item")).toHaveCount(
    activityFeed.batches.filter((batch) => batch.actorKey !== "test-admin")
      .length,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("activity-new-admins")).toBeVisible();
  await expect(page.getByTestId("activity-more")).toBeVisible();
  // The month: its total, and its columns drawn.
  const month = page.getByTestId("activity-month-chart");
  await expect(month.getByText(/1\s?326/).first()).toBeVisible();
  await expect(month.locator(".apexcharts-svg")).toHaveCount(1);

  // The pointer off the chart, whose tooltip it would otherwise open.
  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("aktywnosc.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
