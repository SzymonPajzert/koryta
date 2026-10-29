import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { answerForTheSector } from "./fixtures/obronnosc";
import { pageTag } from "./pageTags";

/** „Skarb Państwa”, the companies on Prokuratoria's list of the Treasury's
 * stakes (Szymon, 2026-10-28): the table's filter bar with it picked, and the
 * category list with it open, where it is the last entry - after the sectors,
 * as it says who owns a company rather than what it does. And the company
 * form, which does not offer it: the owner follows the list even where a
 * person set the sectors, so the field there is „Branże” (Szymon picked it
 * on the design board, 2026-10-29).
 *
 * Nothing in the seed is filed under a category, so the requests are answered
 * with a seeded company's own people, as ./obronnosc.spec.ts answers its own. */

const NOWE = { tag: pageTag("eksploruj/nowe") };
const TABELA = { tag: pageTag("eksploruj/tabela") };
const COMPANY = { tag: pageTag("[seoType]/[slug]") };

const CATEGORY = "skarb-panstwa";
const QUEUE = `/eksploruj/nowe?category=${CATEGORY}&currentlyEmployed=selected&minVotes=0`;
const TABLE = `/eksploruj/tabela?category=${CATEGORY}&currentlyEmployed=selected`;

/** After the clicks: the pointer off the last control, every ripple and
 * transition played out, and the fonts in. */
async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.locator(".v-ripple__animation")).toHaveCount(0);
  await expect(
    page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test("kolejka-skarb-panstwa-wybor", NOWE, async ({ page }) => {
  test.setTimeout(120_000);
  await answerForTheSector(page, { queue: true, category: CATEGORY });
  await logIn(page, USERS.normal, QUEUE);

  const filters = page.getByTestId("queue-filters");
  await expect(filters.getByText("Skarb Państwa", { exact: true })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await filters.locator(".v-select", { hasText: "Typ podmiotu" }).click();
  const menu = page.getByRole("listbox");
  await expect(
    menu.getByRole("option", { name: "Skarb Państwa", selected: true }),
  ).toBeVisible();

  await settle(page);
  await expect(menu).toHaveScreenshot("kolejka-skarb-panstwa-wybor.png");
});

test("tabela-skarb-panstwa", TABELA, async ({ page }) => {
  test.setTimeout(120_000);
  await answerForTheSector(page, { queue: false, category: CATEGORY });
  await logIn(page, USERS.normal, TABLE);

  const bar = page.getByTestId("tabela-query-bar");
  await expect(
    bar.locator(".v-chip", { hasText: "Skarb Państwa" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(bar.getByText("4 osoby")).toBeVisible({ timeout: 30_000 });

  await settle(page);
  // Clipped to the window, as tabela-obronnosc is: the table makes the page
  // wider than the screen, and the bar stretches to it.
  const box = (await bar.boundingBox())!;
  const view = page.viewportSize()!;
  await expect(page).toHaveScreenshot("tabela-skarb-panstwa.png", {
    clip: {
      x: box.x,
      y: box.y,
      width: Math.min(box.width, view.width - box.x),
      height: box.height,
    },
  });
});

/** The seeded company, answered as a Treasury company whose sectors a person
 * set - PGE's shape: „Energetyka” by hand, „Skarb Państwa” from the list.
 * By path, as ./company-wikipedia.spec.ts does: the node is fetched in the
 * browser once `logIn` has redirected there. */
async function openTreasuryCompanyForm(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/nodes/sukspolka",
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.node.categories = ["energetyka", "skarb-panstwa"];
      body.node.categoriesSource = "manual";
      await route.fulfill({ response, json: body });
    },
  );
  await logIn(
    page,
    USERS.normal,
    "/instytucja/wojewodzki-zaklad-testowy-sukspolka",
  );
  await expect(page.getByTestId("company-summary")).toBeVisible({
    timeout: 30_000,
  });

  const button = page.getByRole("button", { name: "Zaproponuj zmianę" });
  const dialog = page.locator('.v-dialog:has-text("Zaproponuj zmianę")');
  // Retried as a whole: a click before Vue has attached the listener is
  // dropped - the race ./propose-confirmation.spec.ts handles the same way.
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

test("instytucja-zmiana-branze", COMPANY, async ({ page }) => {
  test.setTimeout(120_000);
  // Tall enough for the whole form, as instytucja-zmiana-dialog is.
  const { width } = page.viewportSize()!;
  await page.setViewportSize({ width, height: 2000 });
  const dialog = await openTreasuryCompanyForm(page);

  // The sector alone: the owner is not the form's to change, and the server
  // keeps it through a save.
  const field = dialog.locator(".v-select", { hasText: "Branże" });
  await expect(field.locator(".v-chip")).toHaveText(["Energetyka"]);

  await settle(page);
  await expect(dialog.locator(".v-overlay__content")).toHaveScreenshot(
    "instytucja-zmiana-branze.png",
  );
});

test("instytucja-zmiana-branze-lista", COMPANY, async ({ page }) => {
  test.setTimeout(120_000);
  const dialog = await openTreasuryCompanyForm(page);
  const field = dialog.locator(".v-select", { hasText: "Branże" });
  await field.scrollIntoViewIfNeeded();
  await field.locator(".v-field").click();

  const menu = page.getByRole("listbox");
  await expect(menu.getByRole("option", { name: "Obronność" })).toBeVisible();
  await expect(menu.getByRole("option", { name: "Skarb Państwa" })).toHaveCount(
    0,
  );
  // Opened, the list scrolls to its first ticked row. Its end is the point
  // here: it stops at the last sector.
  await menu.evaluate((list) => {
    list.scrollTop = list.scrollHeight;
    if (list.parentElement) {
      list.parentElement.scrollTop = list.parentElement.scrollHeight;
    }
  });

  await settle(page);
  // The menu fades in through an inline transition, which the class check in
  // `settle` does not see.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  await expect(page).toHaveScreenshot("instytucja-zmiana-branze-lista.png");
});
