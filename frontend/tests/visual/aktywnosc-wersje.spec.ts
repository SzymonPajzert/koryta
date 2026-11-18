import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import { automaticActivity } from "./fixtures/activityAutomatic";
import { releaseFeed } from "./fixtures/siteReleases";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** koryta.pl's own rollouts on /aktywnosc, as round aktywnosc-wersje-r1
 * approved them on 2026-11-18: „Nowa wersja strony” among the day's lines on
 * a badge tinted like the rest, a title opened to what changed, and the
 * rollouts alone under the „koryta.pl” filter, whose chip still fits the
 * kinds' row on a computer.
 *
 * The seed has no rollouts and no recent activity, so the feed and the month
 * come from fixtures by route: the page fetches both in the browser, after
 * auth has settled. */

const AKTYWNOSC = { tag: pageTag("aktywnosc") };

async function answerActivity(page: Page) {
  await freezeClock(page);
  await page.route("**/api/stats/activity**", (route) =>
    route.fulfill({ json: automaticActivity }),
  );
  await page.route("**/api/activity/feed**", (route) =>
    route.fulfill({ json: releaseFeed }),
  );
}

test("aktywnosc-wersje", AKTYWNOSC, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerActivity(page);
  await logIn(page, USERS.admin, "/aktywnosc");

  const today = page.getByTestId("activity-day").first();
  await expect(today.getByTestId("feed-release")).toContainText("7 zmian", {
    timeout: 30_000,
  });
  await expect(today.getByTestId("feed-item")).toHaveCount(2);

  await readyForElementShot(page);
  await expect(today).toHaveScreenshot("aktywnosc-wersje.png");

  await expectFitsThePhone(page, testInfo);
});

test("aktywnosc-wersje-filtr", AKTYWNOSC, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerActivity(page);
  await logIn(page, USERS.admin, "/aktywnosc?rodzaj=zmiany");

  const releases = page.getByTestId("feed-release");
  await expect(releases).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByTestId("feed-item")).toHaveCount(0);

  await readyForElementShot(page);
  await expect(page.locator(".v-chip-group").first()).toHaveScreenshot(
    "aktywnosc-wersje-filtr-chipy.png",
  );
  await expect(page.locator(".feed-timeline")).toHaveScreenshot(
    "aktywnosc-wersje-filtr.png",
  );

  await expectFitsThePhone(page, testInfo);
});

test("aktywnosc-wersja-otwarta", AKTYWNOSC, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerActivity(page);
  await logIn(page, USERS.admin, "/aktywnosc");

  const release = page.getByTestId("feed-release").first();
  await expect(release).toBeVisible({ timeout: 30_000 });
  await release.getByTestId("activity-release-more").click();
  await expect(release.getByTestId("activity-site-change")).toHaveCount(7);
  await release.getByTestId("activity-site-change-toggle").first().click();
  await expect(release.getByTestId("activity-site-change-qa")).toBeVisible();

  await readyForElementShot(page);
  await expect(release).toHaveScreenshot("aktywnosc-wersja-otwarta.png");

  await expectFitsThePhone(page, testInfo);
});
