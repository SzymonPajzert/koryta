import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { opsJobs } from "./fixtures/opsJobs";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/procesy, every job's state: the rows that need looking at open by
 * themselves, and the nightly scrape and the people import opened by hand to
 * show their runs.
 *
 * The runs live in the ops database, which the seed leaves empty, and two
 * jobs are read off production buckets, so the overview is answered from
 * ./fixtures/opsJobs.ts. The page is rendered in the browser only (`ssr:
 * false` on /admin/**), which is what lets a route handler answer it, and it
 * counts every age against the frozen clock. */

const PROCESY = { tag: pageTag("admin/procesy") };

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
  // Only a GET is answered, as by the real route.
  await page.route("**/api/ops/jobs**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: opsJobs })
      : route.fulfill({ status: 404, json: { message: "Page not found" } }),
  );
});

test("procesy", PROCESY, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/procesy");

  // A job only the fixture has, so a run that drew an empty page fails here.
  const others = page.locator('[data-job="people_upload"]');
  await expect(others).toBeVisible({ timeout: 30_000 });

  // What the fixture puts in each state, read back off the rows.
  await expect(page.locator('[data-job="capture_extraction"]')).toHaveAttribute(
    "data-health",
    "stalled",
  );
  await expect(page.locator('[data-job="compressor"]')).toHaveAttribute(
    "data-health",
    "stale",
  );
  await expect(page.locator('[data-job="krs_scrape_free"]')).toHaveAttribute(
    "data-health",
    "partial",
  );
  await expect(page.locator('[data-job="article_crawl"]')).toHaveAttribute(
    "data-health",
    "running",
  );
  await expect(page.locator('[data-job="people_import"]')).toHaveAttribute(
    "data-health",
    "partial",
  );
  // Triggered, and judged by its own run rather than as captures.
  await expect(page.locator('[data-job="company_import"]')).toHaveAttribute(
    "data-health",
    "ok",
  );

  // The nightly scrape is fine enough to start closed; open it for its runs.
  const free = page.locator('[data-job="krs_scrape_free"]');
  await free.locator("[data-row-toggle]").first().click();
  await expect(free.locator('[data-run="free-0830"]')).toBeVisible();

  // So is the people import: open it for what its run did to the pages, and
  // the trial before it that sent nothing.
  const people = page.locator('[data-job="people_import"]');
  await people.locator("[data-row-toggle]").first().click();
  await expect(people.locator('[data-run="people-0831"]')).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("procesy.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
