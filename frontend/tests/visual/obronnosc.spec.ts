import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { answerForTheSector } from "./fixtures/obronnosc";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** The defence sector, „Obronność”, on the two pages it is worked from: the
 * queue at /eksploruj/nowe with „Typ podmiotu” set to it - the link the
 * state-company project's volunteers are sent - and the table's filter bar,
 * whose chip draws the sector's shield.
 *
 * Nothing in the seed is filed under a sector, so ./fixtures/obronnosc.ts
 * answers the sector's requests with a seeded company's own people. */

const NOWE = { tag: pageTag("eksploruj/nowe") };
const TABELA = { tag: pageTag("eksploruj/tabela") };

const QUEUE =
  "/eksploruj/nowe?category=obronnosc&currentlyEmployed=selected&minVotes=0";
const TABLE = "/eksploruj/tabela?category=obronnosc&currentlyEmployed=selected";

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

/** The queue's filter strip, once the sector has reached the api and the
 * count has come back. */
async function openQueue(page: Page) {
  await answerForTheSector(page, { queue: true });
  const asked = page.waitForRequest(
    (request) =>
      request.url().includes("/api/nodes?") &&
      new URL(request.url()).searchParams.get("category") === "obronnosc",
  );
  await logIn(page, USERS.normal, QUEUE);
  await asked;

  const filters = page.getByTestId("queue-filters");
  await expect(filters.getByText("Obronność", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(filters.getByText(/W kolejce: 4 osoby/)).toBeVisible({
    timeout: 30_000,
  });
  return filters;
}

test("kolejka-obronnosc", NOWE, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const filters = await openQueue(page);

  await settle(page);
  await expect(filters).toHaveScreenshot("kolejka-obronnosc.png");

  await expectFitsThePhone(page, testInfo);
});

test("kolejka-obronnosc-wybor", NOWE, async ({ page }) => {
  test.setTimeout(120_000);
  const filters = await openQueue(page);

  // „Typ podmiotu” open: the last sector, just above „Skarb Państwa”, and the
  // one picked. The menu scrolls it into view itself.
  await filters.locator(".v-select", { hasText: "Typ podmiotu" }).click();
  const menu = page.getByRole("listbox");
  await expect(
    menu.getByRole("option", { name: "Obronność", selected: true }),
  ).toBeVisible();

  await settle(page);
  await expect(menu).toHaveScreenshot("kolejka-obronnosc-wybor.png");
});

test("tabela-obronnosc", TABELA, async ({ page }) => {
  test.setTimeout(120_000);
  await answerForTheSector(page, { queue: false });
  await logIn(page, USERS.normal, TABLE);

  const bar = page.getByTestId("tabela-query-bar");
  await expect(bar.locator(".v-chip", { hasText: "Obronność" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(bar.getByText("4 osoby")).toBeVisible({ timeout: 30_000 });
  await expect(bar.getByText(/sprawdzono \d+ z/)).toBeVisible({
    timeout: 30_000,
  });

  await settle(page);
  // Clipped to the window rather than shot as an element, for the reason
  // progress-bar.spec.ts gives: the table makes the page wider than the
  // screen, and the bar stretches to it. On a phone the two chips are crushed
  // to slivers - fix-explore-pages-on-phones-for-volunteers - and this is the
  // baseline its fix moves.
  const box = (await bar.boundingBox())!;
  const view = page.viewportSize()!;
  await expect(page).toHaveScreenshot("tabela-obronnosc.png", {
    clip: {
      x: box.x,
      y: box.y,
      width: Math.min(box.width, view.width - box.x),
      height: box.height,
    },
  });
});
