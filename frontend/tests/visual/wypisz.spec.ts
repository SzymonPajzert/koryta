import { test, expect } from "./test";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /wypisz, where a campaign's „Wypisz się” lands: the question, and the page
 * once the reader confirmed. Signed out, as a reader coming from their inbox
 * usually is. The confirmation is answered here rather than by the server,
 * which would refuse a token it never issued. */

const WYPISZ = { tag: pageTag("wypisz") };
const LINK = "/wypisz?u=czytelnik&t=token&k=callsToAction&c=2026-08-31-pilot";

test("wypisz", WYPISZ, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto(LINK, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-unsubscribe-confirm]")).toBeVisible({
    timeout: 30_000,
  });

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("wypisz.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("wypisz-gotowe", WYPISZ, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.route("**/api/mail/unsubscribe", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: { outcome: "unsubscribed", topic: "callsToAction" },
        })
      : route.fallback(),
  );
  await page.goto(LINK, { waitUntil: "domcontentloaded" });
  await page.locator("[data-unsubscribe-confirm]").click();
  await expect(page.locator("[data-unsubscribe-done]")).toBeVisible({
    timeout: 30_000,
  });

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("wypisz-gotowe.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
