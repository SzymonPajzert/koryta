import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { feedbackReports, fixedReports } from "./fixtures/feedbackReports";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /qa, the list of changes to check, as a contributor opens it - and as an
 * admin does, with the open reports this build says it fixes above the list.
 *
 * WHY MOST OF THE LIST IS HIDDEN. The page lists every entry in shared/qa.ts,
 * newest first, and every change a reader can see adds one - so a shot of the
 * whole list would fail on every commit that follows the rule. Four of the
 * oldest entries are kept instead, one from each area, which nobody edits
 * once they are down the list. The rest are hidden with CSS rather than
 * removed, because Vue still owns those nodes.
 *
 * The one thing that still moves is the count on „Do sprawdzenia”, by a digit
 * per entry, which is far inside the 1% the comparison allows - and, for an
 * admin, the same count on the head over their own entries.
 *
 * The admin's reports are /admin/opinie's, which the seed has none of, so
 * they are answered from ./fixtures/feedbackReports.ts, the clock frozen for
 * their dates. */

const QA = { tag: pageTag("qa") };

/** Oldest last, as the page orders them. */
const KEPT = [
  "my-contributions",
  "reviewer-queue",
  "cite-existing-relation",
  "person-search-by-city",
];

/** Open, to show the steps and the two verdict buttons. */
const OPENED = "reviewer-queue";

/** Wait for the list, and hide all of it but `KEPT`. */
async function keepTheOldestEntries(page: Page) {
  // Set once the reader's verdicts have been read, which is also when the
  // rows are drawn in their real state rather than as a skeleton.
  await expect(page.locator('[data-qa-loaded="true"]')).toBeVisible({
    timeout: 30_000,
  });
  for (const id of KEPT) {
    await expect(page.locator(`[data-qa-item="${id}"]`)).toBeVisible();
  }

  const others = KEPT.map((id) => `:not([data-qa-item="${id}"])`).join("");
  await page.addStyleTag({
    content: [
      `[data-qa-item]${others} { display: none !important; }`,
      // Rows are ruled off with `.arow + .arow`, which counts the hidden
      // row before the first one kept.
      `[data-qa-item="${KEPT[0]}"] { border-top: none !important; }`,
    ].join("\n"),
  });
}

test("qa", QA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.normal, "/qa");
  await keepTheOldestEntries(page);

  const opened = page.locator(`[data-qa-item="${OPENED}"]`);
  await opened.locator("[data-row-toggle]").click();
  await expect(opened.locator("[data-row-panel]")).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("qa.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("qa-do-zamkniecia", QA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await page.route("**/api/feedback/list**", (route) =>
    route.fulfill({
      json: {
        feedback: [...feedbackReports, ...fixedReports],
        openTruncated: false,
      },
    }),
  );
  await logIn(page, USERS.admin, "/qa");

  // The two the fixture's claims name, and none of the other open reports -
  // so a run whose list never arrived, or which claims nothing, fails here.
  const section = page.locator('[data-section="fixed-reports"]');
  await expect(section).toBeVisible({ timeout: 30_000 });
  const reports = page.locator("[data-report-row]");
  await expect(reports).toHaveCount(fixedReports.length);
  await keepTheOldestEntries(page);

  // The one outside the queue, open: what changed, and the way to close it.
  const opened = page.locator(`#fb-${fixedReports[1]!.id}`);
  await opened.locator("[data-row-toggle]").click();
  await expect(opened.locator("[data-fix-change]")).toBeVisible();

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("qa-do-zamkniecia.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});
