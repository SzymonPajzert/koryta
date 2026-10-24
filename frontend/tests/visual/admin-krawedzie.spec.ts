import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { unpublishedEdges } from "./fixtures/unpublishedEdges";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/krawedzie, the relations ready to publish because both their ends
 * already are.
 *
 * Answered from ./fixtures/unpublishedEdges.ts: which seeded relations are
 * ready depends on what the other specs have published by the time this one
 * runs. The page is rendered in the browser only (`ssr: false` on /admin/**),
 * which is what lets a route handler answer it. It prints no dates relative to
 * today, so the clock is left alone. */

const KRAWEDZIE = { tag: pageTag("admin/krawedzie") };

test("krawedzie", KRAWEDZIE, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  // Only a GET is answered, as by the real route.
  await page.route("**/api/edges/unpublished**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: unpublishedEdges })
      : route.fulfill({ status: 404, json: { message: "Page not found" } }),
  );
  await logIn(page, USERS.admin, "/admin/krawedzie");

  // Every fixture row, and the counter only a scan that hit its limit draws,
  // so a run that drew the seed fails here.
  const table = page.getByTestId("edges-queue-table");
  await expect(table.locator("tbody tr")).toHaveCount(
    unpublishedEdges.edges.length,
    { timeout: 30_000 },
  );
  // polishNumber leaves four digits ungrouped today („3000”); grouping them is
  // an open question, so either form passes.
  await expect(page.getByText(/Przejrzano 3\s?000 powiązań/)).toBeVisible();
  await expect(page.getByTestId("edges-load-more")).toBeVisible();

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("krawedzie.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
