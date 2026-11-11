import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";
import { logIn, USERS } from "../e2e/helpers/auth";
import { POWIAT, powiatOffices, withUrzad } from "./fixtures/regionOffices";

/** A post in a region's urząd, recorded from a person's page: the choice in
 * „Dodaj powiązanie”, the urzędy it offers, what it says when it finds none,
 * and the row the post leaves on the page.
 *
 * Opole is in the seed with its TERYT code, so its urząd comes from the shipped
 * table through the real endpoint. A powiat with gminy is not, so the search
 * that finds Powiat wejherowski and the urzędy it lists are answered from
 * ./fixtures/regionOffices.ts, and so is the saved row: added to the graph the
 * person page asks for, because a relation really written here would still be
 * on Piotr Wiśniewski's page when relation-sources.spec.ts photographs it.
 *
 * Signed in as the seed's reader on Piotr Wiśniewski (4). The dialog scrolls
 * inside itself, so it is photographed in a window tall enough for all of it.
 */

const PERSON = "/entity/person/4";

async function openDialog(page: Page, height: number) {
  await page.setViewportSize({ width: page.viewportSize()!.width, height });
  await logIn(page, USERS.normal, PERSON);
  await page.getByTestId("add-relation-employment").click({ timeout: 30_000 });
  const dialog = page.getByTestId("add-relation-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/** Retried as a whole: until the dialog has hydrated, a `fill` writes the DOM
 * value without it reaching the component, so no search is ever issued. */
async function pickRegion(page: Page, name: string) {
  const input = page.getByTestId("add-relation-entity").locator("input");
  const option = page.getByRole("option", { name, exact: true });
  await expect(async () => {
    await input.fill(name);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();
}

/** The choice that asks where in the region, with its answer in. */
async function chooseOffice(page: Page) {
  const dialog = page.getByTestId("add-relation-dialog");
  await dialog.getByTestId("add-relation-verb-office").click();
  await expect(dialog.getByTestId("region-workplace-loading")).toBeHidden({
    timeout: 30_000,
  });
}

/** Nothing moving and nothing hovered: the menu the pick closed, the chip's
 * ripple, the transitions, the fonts. */
async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.locator(".v-ripple__animation")).toHaveCount(0);
  await expect(
    page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test.describe(
  "A post in a region's urząd",
  { tag: pageTag("[seoType]/[slug]") },
  () => {
    test("powiazanie-urzad-miasta", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const dialog = await openDialog(page, 1400);
      await pickRegion(page, "Opole");
      await chooseOffice(page);
      // A gmina has one urząd, and it is picked for the contributor.
      await expect(
        dialog
          .getByTestId("region-workplace-office-000584805")
          .locator("input"),
      ).toBeChecked();
      await settle(page);

      await expect(dialog).toHaveScreenshot("powiazanie-urzad-miasta.png");
      await expectFitsThePhone(page, testInfo);
    });

    test("powiazanie-urzedy-powiatu", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.route("**/api/search**", async (route) => {
        const q = new URL(route.request().url()).searchParams.get("q");
        if (q?.trim().toLowerCase() !== POWIAT.name.toLowerCase()) {
          return route.fallback();
        }
        await route.fulfill({ json: [POWIAT] });
      });
      await page.route(`**/api/nodes/${POWIAT.id}/offices`, (route) =>
        route.fulfill({ json: powiatOffices }),
      );
      const dialog = await openDialog(page, 2000);
      await pickRegion(page, POWIAT.name);
      await chooseOffice(page);
      // The starostwo and the ten gminy's urzędy, none picked in advance.
      await expect(
        dialog.locator('[data-testid^="region-workplace-office-"]'),
      ).toHaveCount(11);
      await settle(page);

      await expect(dialog).toHaveScreenshot("powiazanie-urzedy-powiatu.png");
      await expectFitsThePhone(page, testInfo);
    });

    test("powiazanie-urzad-nie-znaleziono", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.route("**/api/nodes/opole-powiat/offices", (route) =>
        route.fulfill({ json: { offices: [] } }),
      );
      const dialog = await openDialog(page, 1400);
      await pickRegion(page, "Opole");
      await chooseOffice(page);
      await expect(dialog.getByTestId("region-workplace-none")).toBeVisible();
      await settle(page);

      await expect(dialog).toHaveScreenshot(
        "powiazanie-urzad-nie-znaleziono.png",
      );
      await expectFitsThePhone(page, testInfo);
    });

    test("powiazania-urzad-na-liscie", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.route("**/api/graph/local/4**", async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: withUrzad(await response.json(), "4"),
        });
      });
      await logIn(page, USERS.normal, PERSON);
      const relations = page.getByTestId("relations-history");
      await expect(relations).toContainText("Urząd Miasta Opola", {
        timeout: 30_000,
      });
      await settle(page);

      await expect(relations).toHaveScreenshot(
        "powiazania-urzad-na-liscie.png",
      );
      await expectFitsThePhone(page, testInfo);
    });
  },
);
