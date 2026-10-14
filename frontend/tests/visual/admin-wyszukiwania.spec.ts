import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { searchesSummary } from "./fixtures/searches";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/wyszukiwania, what readers searched for: every query with what its
 * searches found.
 *
 * The searches live in the ops database, which the seed leaves empty, so the
 * summary is answered from ./fixtures/searches.ts. The page is rendered in the
 * browser only (`ssr: false` on /admin/**), which is what lets a route handler
 * answer it. The seeded admin carries the `owner` claim the page asks for. */

const WYSZUKIWANIA = { tag: pageTag("admin/wyszukiwania") };

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
  await page.route("**/api/admin/searches**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: searchesSummary })
      : route.fulfill({ status: 404, json: { message: "Page not found" } }),
  );
});

test("wyszukiwania", WYSZUKIWANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/wyszukiwania");

  // A query only the fixture has, so a run that drew an empty table fails
  // here instead of banking „Nikt jeszcze niczego takiego nie szukał”.
  const table = page.getByTestId("searches-table");
  await expect(table).toContainText("katarzyna przykładowa", {
    timeout: 30_000,
  });

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("wyszukiwania.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
