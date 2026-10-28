import { test, expect } from "./test";
import type { Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { searchesSummary } from "./fixtures/searches";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/wyszukiwania, what readers searched for: how the searches ended,
 * day by day, over every query with what its searches found.
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

/** Signed in on the page, with the list and the chart drawn. */
async function openSearches(page: Page) {
  await logIn(page, USERS.admin, "/admin/wyszukiwania");

  // A query only the fixture has, so a run that drew an empty table fails
  // here instead of banking „Nikt jeszcze niczego takiego nie szukał”.
  const table = page.getByTestId("searches-table");
  await expect(table).toContainText("katarzyna przykładowa", {
    timeout: 30_000,
  });
  // The chart is drawn after the card mounts.
  await expect(
    page.getByTestId("search-endings").locator(".apexcharts-svg"),
  ).toBeVisible({ timeout: 30_000 });
}

/** One of the card's switches, and the redraw it causes. */
async function pick(page: Page, testId: string, name: string) {
  await page
    .getByTestId(testId)
    .getByRole("button", { name, exact: true })
    .click();
  // The pointer would leave the button's hover and a tooltip in the shot.
  await page.mouse.move(0, 0);
}

test("wyszukiwania", WYSZUKIWANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openSearches(page);

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("wyszukiwania.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("wyszukiwania-tygodnie", WYSZUKIWANIA, async ({ page }) => {
  test.setTimeout(120_000);
  await openSearches(page);

  // Weeks, in counts: both of the card's switches off their defaults.
  await pick(page, "search-endings-period", "Tygodnie");
  await pick(page, "search-endings-scale", "Liczba");
  await expect(page.getByTestId("search-endings")).toContainText(
    "Tydzień po tygodniu",
  );
  await expect(
    page.getByTestId("search-endings").locator(".apexcharts-svg"),
  ).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("wyszukiwania-tygodnie.png", {
    fullPage: true,
  });
});

test("wyszukiwania-tabela", WYSZUKIWANIA, async ({ page }) => {
  test.setTimeout(120_000);
  await openSearches(page);

  // The chart's numbers as a table, in the shares the card opens on.
  await page
    .getByTestId("search-endings")
    .getByRole("button", { name: "Tabela z liczbami" })
    .click();
  await page.mouse.move(0, 0);
  await expect(page.getByTestId("search-endings")).toContainText("Razem");

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("wyszukiwania-tabela.png", {
    fullPage: true,
  });
});
