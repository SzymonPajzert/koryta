import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { pageTag } from "./pageTags";
import { logIn, USERS } from "../e2e/helpers/auth";
import { expectFitsThePhone } from "./phoneWidth";

/** Whether a company's seats are paid: the chip beside „Instytucja publiczna”
 * and the reason it opens (`PlacePaidSeats`, picked on round
 * platne-funkcje-r1, decision on 2026-11-20).
 *
 * No seeded company has `paidSeats`, so the node is answered on the one
 * response, as `company-wikipedia.spec.ts` gives one its link: every other
 * shot of the company page stays as the seed has it. The answer and the quote
 * are Stowarzyszenie Gmin Polskich Euroregionu Pomerania's, from its statute.
 * Signed in, because only a client-side fetch reaches the handler.
 */

const COMPANY_ID = "sukspolka";
const COMPANY_URL = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";
const REASON =
  "Statut, § 20 ust. 8: „Członkowie Zarządu nie otrzymują wynagrodzenia za czynności wykonywane w związku z pełnioną funkcją.” https://pomerania.org.pl/wp-content/uploads/2026/01/Statut_SGPEP_2025.pdf";

async function openWithAnswer(page: Page) {
  // By path, not by glob, for the reason `company-wikipedia.spec.ts` gives.
  await page.route(
    (url) => url.pathname === `/api/nodes/${COMPANY_ID}`,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.node.paidSeats = false;
      body.node.paidSeatsReason = REASON;
      await route.fulfill({ response, json: body });
    },
  );

  await logIn(page, USERS.normal, COMPANY_URL);

  const card = page.getByTestId("company-summary");
  await expect(card).toBeVisible({ timeout: 30_000 });
  // Only the handler puts it there, so a run that drew the seeded node fails
  // here rather than banking a card without the chip.
  await expect(card.getByTestId("company-paid-seats")).toBeVisible({
    timeout: 30_000,
  });
  return card;
}

test.describe("Płatne funkcje", { tag: pageTag("[seoType]/[slug]") }, () => {
  test("instytucja-platne-funkcje", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const card = await openWithAnswer(page);

    await expect(card.getByTestId("company-paid-seats")).toHaveText(
      "Funkcje bez wynagrodzenia",
    );

    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await expect(card).toHaveScreenshot("instytucja-platne-funkcje.png");

    await expectFitsThePhone(page, testInfo);
  });

  test("instytucja-platne-funkcje-powod", async ({ page }) => {
    test.setTimeout(120_000);
    const card = await openWithAnswer(page);

    const reason = page.getByTestId("company-paid-seats-reason");
    // Retried as a whole: a click before Vue has attached the listener is
    // dropped, as `company-wikipedia.spec.ts` says of its dialog.
    await expect(async () => {
      if (await reason.isVisible()) return;
      await card.getByTestId("company-paid-seats").click();
      await expect(reason).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });

    await expect(reason.getByRole("link")).toHaveText("pomerania.org.pl");
    // The menu fades in, and a shot mid-transition is translucent.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running"),
    );
    await page.evaluate(() => document.fonts.ready);
    await expect(reason).toHaveScreenshot(
      "instytucja-platne-funkcje-powod.png",
    );
  });
});
