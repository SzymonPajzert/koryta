import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { feedbackReports } from "./fixtures/feedbackReports";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/opinie, the reports people sent, as the team works through them:
 * the queue the page opens on, with the ones nobody has placed yet under it,
 * and the full list, with the closed ones folded away - each with one report
 * open.
 *
 * The seed has no reports - it clears the collection - so the list is
 * answered from ./fixtures/feedbackReports.ts. The page is rendered in the
 * browser only (`ssr: false` on /admin/**), which is what lets a route handler
 * answer it, and the clock is frozen so each row's age reads the same every
 * day. */

const OPINIE = { tag: pageTag("admin/opinie") };

async function openReports(page: Page, path: string) {
  await freezeClock(page);
  await page.route("**/api/feedback/list**", (route) =>
    route.fulfill({
      json: { feedback: feedbackReports, openTruncated: false },
    }),
  );
  await logIn(page, USERS.admin, path);

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
}

test("opinie", OPINIE, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openReports(page, "/admin/opinie");
  // The queue, with its arrows on every line, the open one's too.
  await expect(page.locator("[data-queue-row]#fb-wizfb4")).toBeVisible();

  await expect(page).toHaveScreenshot("opinie.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("opinie-lista", OPINIE, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openReports(page, "/admin/opinie?widok=lista");
  await expect(page.locator("[data-toggle-closed]")).toBeVisible();

  await expect(page).toHaveScreenshot("opinie-lista.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
