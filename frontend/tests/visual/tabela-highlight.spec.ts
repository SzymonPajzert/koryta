import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { answerWithMatches } from "./fixtures/matchedCompanies";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** The companies that put a person in the table, marked in the rows: first in
 * the „Firmy” cell, in the sage of a matched election run, with the sector's
 * icon from the filter bar - or, where only a company above the person's
 * employer is in the sector, a dashed „grupa …” chip naming it. Szymon picked
 * this look on the design board (tabela-highlight-r1, 2026-10-29).
 *
 * Nothing in the seed is filed under a sector, so ./fixtures/matchedCompanies.ts
 * answers the sector with a seeded company's people. The region filter needs
 * no stand-in: Orlen is seated in a seeded województwo. */

const TABELA = { tag: pageTag("eksploruj/tabela") };

const SECTOR_TABLE =
  "/eksploruj/tabela?category=obronnosc&currentlyEmployed=selected";
const REGION_TABLE = "/eksploruj/tabela?teryt=22";

/** After the clicks: the pointer off the last control, whose hover tint would
 * otherwise be in the shot, every ripple and transition played out, and the
 * fonts in. */
async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.locator(".v-ripple__animation")).toHaveCount(0);
  await expect(
    page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test("tabela-dopasowane-firmy", TABELA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerWithMatches(page);
  await logIn(page, USERS.normal, SECTOR_TABLE);

  const table = page.locator(".table-card");
  // `:visible`: the company and the group are each drawn once, but wait on the
  // ones a reader sees rather than on whatever the DOM has first.
  await expect(
    table.locator('.company-chip[data-match="company"]:visible').first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    table.locator('.company-chip[data-match="owner"]:visible'),
  ).toHaveCount(1, { timeout: 30_000 });

  await settle(page);
  await expect(table).toHaveScreenshot("tabela-dopasowane-firmy.png");

  await expectFitsThePhone(page, testInfo);
});

test("tabela-region-siedziba", TABELA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto(REGION_TABLE);

  const table = page.locator(".table-card");
  await expect(
    table.locator('.company-chip[data-match="region"]:visible').first(),
  ).toBeVisible({ timeout: 30_000 });

  await settle(page);
  await expect(table).toHaveScreenshot("tabela-region-siedziba.png");

  await expectFitsThePhone(page, testInfo);
});
