import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { answerForTheSector } from "./fixtures/obronnosc";
import { pageTag } from "./pageTags";

/** „Skarb Państwa”, the companies on Prokuratoria's list of the Treasury's
 * stakes (Szymon, 2026-10-28): the table's filter bar with it picked, and the
 * category list with it open, where it is the last entry - after the sectors,
 * as it says who owns a company rather than what it does.
 *
 * Nothing in the seed is filed under a category, so the requests are answered
 * with a seeded company's own people, as ./obronnosc.spec.ts answers its own. */

const NOWE = { tag: pageTag("eksploruj/nowe") };
const TABELA = { tag: pageTag("eksploruj/tabela") };

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
