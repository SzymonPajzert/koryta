import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { feedbackReports } from "./fixtures/feedbackReports";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/opinie, the reports people sent, as the team works through them:
 * the ones nobody has placed yet, the queue, and the closed ones folded away,
 * with one report open.
 *
 * The seed has no reports - it clears the collection - so the list is
 * answered from ./fixtures/feedbackReports.ts. The page is rendered in the
 * browser only (`ssr: false` on /admin/**), which is what lets a route handler
 * answer it, and the clock is frozen so each row's age reads the same every
 * day. */

const OPINIE = { tag: pageTag("admin/opinie") };

test("opinie", OPINIE, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await page.route("**/api/feedback/list**", (route) =>
    route.fulfill({
      json: { feedback: feedbackReports, openTruncated: false },
    }),
  );
  await logIn(page, USERS.admin, "/admin/opinie");

  // A report only the fixture has, so a run that drew the empty seed fails
  // here instead of banking „Nic jeszcze nie wpłynęło”.
  const report = page.locator("#fb-wizfb4");
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#fb-wizfb1")).toBeVisible();

  // The report sent from /qa, open: the row carries the entry it was written
  // about, and the open row is where the status and the note are set.
  await report.locator("[data-row-toggle]").click();
  await expect(report.locator("[data-row-panel]")).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("opinie.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
