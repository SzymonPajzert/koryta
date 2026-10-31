import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import { automaticActivity, automaticFeed } from "./fixtures/activityAutomatic";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** What the declarations' automation publishes on its own, as round
 * bip-autopublish-r2 approved it: on /aktywnosc its own line, „Automat” with
 * the tag of what it went by, and the month counted with it („… od 3 osób i
 * automatu”); on /eksploruj/statystyki inside „Opublikowane osoby”, with how
 * many of them it published under the tile.
 *
 * The seed has no audit rows and no recent activity, so both answers come
 * from ./fixtures/activityAutomatic.ts by route: both pages fetch them in the
 * browser, after auth has settled. */

const AKTYWNOSC = { tag: pageTag("aktywnosc") };
const STATYSTYKI = { tag: pageTag("eksploruj/statystyki") };

async function answerActivity(page: Page) {
  await freezeClock(page);
  await page.route("**/api/stats/activity**", (route) =>
    route.fulfill({ json: automaticActivity }),
  );
  await page.route("**/api/activity/feed**", (route) =>
    route.fulfill({ json: automaticFeed }),
  );
}

test("aktywnosc-automat", AKTYWNOSC, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerActivity(page);
  await logIn(page, USERS.admin, "/aktywnosc");

  const month = page.getByTestId("activity-month-chart");
  await expect(month).toContainText("od 3 osób i automatu", {
    timeout: 30_000,
  });
  await expect(month.locator(".apexcharts-canvas")).toBeVisible();
  const today = page.getByTestId("activity-day").first();
  await expect(today.getByTestId("feed-item-automation")).toContainText(
    "oświadczenia majątkowe",
  );
  await expect(today).toContainText("opublikował 21 osób");

  await readyForElementShot(page);
  await expect(month).toHaveScreenshot("aktywnosc-automat-miesiac.png");
  await expect(today).toHaveScreenshot("aktywnosc-automat.png");

  await expectFitsThePhone(page, testInfo);
});

test("statystyki-automat", STATYSTYKI, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerActivity(page);
  await page.goto("/eksploruj/statystyki");

  const tiles = page
    .locator(".v-card")
    .filter({ hasText: "w tym 267 automatycznie" })
    .first();
  await expect(tiles).toBeVisible({ timeout: 30_000 });
  const timeline = page
    .locator(".v-card")
    .filter({ hasText: "Co się działo w bazie" })
    .first();
  await expect(timeline.locator(".apexcharts-canvas")).toBeVisible();

  await readyForElementShot(page);
  await expect(tiles).toHaveScreenshot("statystyki-automat.png");
  await expect(timeline).toHaveScreenshot("statystyki-automat-wykres.png");

  await expectFitsThePhone(page, testInfo);
});
