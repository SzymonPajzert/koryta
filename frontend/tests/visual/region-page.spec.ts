import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { openInApp, shootWholePage } from "./entityPage";
import { readyForElementShot } from "./elementShot";
import { RADNA, regionPage } from "./fixtures/regionPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** A region's page as Szymon approved it on board round region-lists-r5
 * (2026-11-18): the admin pages' head with the breadcrumbs under the name;
 * the box of the runs of the person the reader came from, its list opened in
 * it; „Władze” - the head as a seat card, the council's seats by committee,
 * „Wszyscy” side by side and a tab per committee; the region's companies
 * („Spółki w regionie”), then „Listy wyborcze”.
 *
 * Gmina Łowicz is ./fixtures/regionPage.ts, answered by route handlers - so
 * the page is reached from inside the app (./entityPage.ts says why). */

const REGION = { tag: pageTag("[seoType]/[slug]") };

async function answerRegionPage(page: Page) {
  const { id } = regionPage;
  for (const node of [regionPage.node, ...Object.values(regionPage.parents)]) {
    await page.route(
      (url) => url.pathname === `/api/nodes/${node.id}`,
      (route) => route.fulfill({ json: { node } }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/graph/local/${id}`,
    (route) => route.fulfill({ json: regionPage.graph }),
  );
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/election-lists`,
    (route) => route.fulfill({ json: regionPage.runs }),
  );
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/authorities`,
    (route) => route.fulfill({ json: regionPage.authorities }),
  );
}

/** What every capture waits for: the name, its breadcrumbs, „Władze”. */
async function regionDrawn(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Gmina Łowicz",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("region-crumbs")).toContainText(
    "Powiat łowicki",
  );
  await expect(page.getByTestId("region-authorities-holder")).toContainText(
    "Mariusz Przykładowy",
  );
}

test("region-strona", REGION, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await answerRegionPage(page);
  await openInApp(page, `${regionPage.url}?osoba=${RADNA}`);
  await regionDrawn(page);

  // The box of her runs, the newest list opened in it (A, 2026-11-18).
  const box = page.getByTestId("person-runs");
  await expect(box).toContainText("Halina Radna");
  await box.locator('[data-testid^="person-run-list-"]').first().click();
  await expect(box.getByTestId("list-members")).toBeVisible();

  // „Władze”: the council opens on „Wszyscy”, a box each; one seat unnamed.
  await expect(
    page.getByTestId("region-authorities-all-Rada miasta"),
  ).toBeVisible();
  await expect(
    page.getByTestId("region-authorities-unnamed-Rada miasta"),
  ).toHaveText("Brak danych o jednym radnym.");
  // The companies before the lists.
  await expect(
    page.getByRole("heading", { name: "Spółki w regionie" }),
  ).toBeVisible();
  await expect(page.getByTestId("election-lists")).toBeVisible();

  await shootWholePage(page, "region-strona.png");
  await expectFitsThePhone(page, testInfo);
});

test("region-wladze-komitet", REGION, async ({ page }) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await answerRegionPage(page);
  await openInApp(page, regionPage.url);
  await regionDrawn(page);

  // One committee alone, two to a row on a desktop.
  await page
    .getByTestId("region-authorities-tabs-Rada miasta")
    .getByRole("tab", { name: /PiS/ })
    .click();
  const alone = page.getByTestId("region-authorities-committee-Rada miasta");
  await expect(alone).toContainText("Bogdan Kostrzewski");

  const section = page.getByTestId("region-authorities");
  await readyForElementShot(page);
  await expect(section).toHaveScreenshot("region-wladze-komitet.png");
});

test("region-zaproponuj-zmiane", REGION, async ({ page }) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await answerRegionPage(page);
  await logIn(page, USERS.admin, regionPage.url);
  await regionDrawn(page);

  await page.getByTestId("region-propose-change").click();
  const dialog = page.getByTestId("region-government-dialog");
  await expect(
    dialog.getByTestId("region-government-head-name").locator("input"),
  ).toHaveValue("Mariusz Przykładowy");
  await readyForElementShot(page);
  await expect(dialog).toHaveScreenshot("region-zaproponuj-zmiane.png");
});
