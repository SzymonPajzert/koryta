import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { answerForTheElection, ELECTION } from "./fixtures/elections";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** The „Wybory” filter of /eksploruj/tabela: the bar naming the election, the
 * rows filling the run that matched among the others they list, and the list
 * the election is picked from, with „Kandydowali / Wygrali / Przegrali” in its
 * header. Szymon picked the names („Sejm i Senat 2023”), both marks and the
 * result in the list's header on the design board (election-filter-r1 and
 * -r2, 2026-10-27).
 *
 * Nothing in the seed stood in an election, so ./fixtures/elections.ts
 * answers the filter with a seeded company's people and adds their runs. */

const TABELA = { tag: pageTag("eksploruj/tabela") };
const TABLE = `/eksploruj/tabela?election=${ELECTION}`;
const WON = `${TABLE}&electionResult=won`;

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

/** The table filtered by the election, once the filter has reached the api
 * and the rows have drawn their runs. */
async function openTable(
  page: Page,
  url = TABLE,
  chip = "Wybory: Sejm i Senat 2023",
) {
  await answerForTheElection(page);
  const asked = page.waitForRequest(
    (request) =>
      request.url().includes("/api/nodes?") &&
      new URL(request.url()).searchParams.get("election") === ELECTION,
  );
  await page.goto(url);
  await asked;

  await expect(
    page.getByTestId("tabela-query-bar").locator(".v-chip", { hasText: chip }),
  ).toBeVisible({ timeout: 30_000 });
  // `:visible`: each row draws its chips twice, a copy per width, and the one
  // the desktop hides comes first.
  await expect(page.locator(".election-matched:visible").first()).toBeVisible({
    timeout: 30_000,
  });
}

test("tabela-wybory", TABELA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openTable(page);

  await settle(page);
  await expect(page).toHaveScreenshot("tabela-wybory.png");

  await expectFitsThePhone(page, testInfo);
});

test("tabela-wybory-wygrali", TABELA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openTable(page, WON, "Wygrali: Sejm i Senat 2023");

  await settle(page);
  await expect(page).toHaveScreenshot("tabela-wybory-wygrali.png");

  await expectFitsThePhone(page, testInfo);
});

test("tabela-wybory-lista", TABELA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openTable(page, WON, "Wygrali: Sejm i Senat 2023");

  // The desktop menu or the phone's fullscreen dialog, whichever the width
  // draws: both activators are in the DOM, and a display class picks one.
  const phone = testInfo.project.name === "visual-mobile";
  await page
    .locator(phone ? "button.d-md-none" : "button.d-md-inline-flex", {
      hasText: "Filtry",
    })
    .click();
  const panel = page
    .locator(".v-overlay__content .v-card")
    .filter({ hasText: "Osoba i podmiot" });
  await panel.locator(".v-autocomplete", { hasText: "Wybory" }).click();

  const menu = page.locator(".v-autocomplete__content");
  await expect(
    menu.getByRole("option", { name: "Sejm i Senat 2023", selected: true }),
  ).toBeVisible();
  // The header the list scrolls under, with the result already chosen.
  await expect(
    menu.locator(".v-btn--active", { hasText: "Wygrali" }),
  ).toBeVisible();

  await settle(page);
  await expect(page).toHaveScreenshot("tabela-wybory-lista.png");
});
