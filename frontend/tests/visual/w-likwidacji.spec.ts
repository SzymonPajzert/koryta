import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { answerForTheSector } from "./fixtures/obronnosc";
import { pageTag } from "./pageTags";

/** „W likwidacji”, a company being wound up as the register's name says, filed
 * as a category after its sectors and owner, as „W upadłości” is for a
 * bankruptcy (decision on 2026-11-20): the company's card with it last among
 * the chips, and the table's filter bar with it picked.
 *
 * Nothing in the seed is filed under a category, so the company's node is
 * answered with the register's status in its name, and the table's requests
 * with a seeded company's own people, as ./skarb-panstwa.spec.ts does. */

const TABELA = { tag: pageTag("eksploruj/tabela") };
const COMPANY = { tag: pageTag("[seoType]/[slug]") };

const CATEGORY = "w-likwidacji";
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

test("tabela-w-likwidacji", TABELA, async ({ page }) => {
  test.setTimeout(120_000);
  await answerForTheSector(page, { queue: false, category: CATEGORY });
  await logIn(page, USERS.normal, TABLE);

  const bar = page.getByTestId("tabela-query-bar");
  await expect(bar.locator(".v-chip", { hasText: "W likwidacji" })).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(bar.getByText("4 osoby")).toBeVisible({ timeout: 30_000 });

  await settle(page);
  // Clipped to the window, as tabela-skarb-panstwa is: the table makes the
  // page wider than the screen, and the bar stretches to it.
  const box = (await bar.boundingBox())!;
  const view = page.viewportSize()!;
  await expect(page).toHaveScreenshot("tabela-w-likwidacji.png", {
    clip: {
      x: box.x,
      y: box.y,
      width: Math.min(box.width, view.width - box.x),
      height: box.height,
    },
  });
});

/** The seeded company, answered as a Treasury energy company being wound up.
 * By path, as ./company-wikipedia.spec.ts does: the node is fetched in the
 * browser once `logIn` has redirected there. */
test("instytucja-w-likwidacji", COMPANY, async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(
    (url) => url.pathname === "/api/nodes/sukspolka",
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.node.name = `${body.node.name} W LIKWIDACJI`;
      body.node.categories = ["energetyka", "skarb-panstwa", CATEGORY];
      await route.fulfill({ response, json: body });
    },
  );
  await logIn(
    page,
    USERS.normal,
    "/instytucja/wojewodzki-zaklad-testowy-sukspolka",
  );

  const card = page.getByTestId("company-summary");
  await expect(
    card.locator(".v-chip", { hasText: "W likwidacji" }),
  ).toBeVisible({ timeout: 30_000 });

  await settle(page);
  await expect(card).toHaveScreenshot("instytucja-w-likwidacji.png");
});
