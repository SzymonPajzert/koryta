import { test, expect } from "@playwright/test";

// The Cypress suite these come from also cross-checked the "Łącznie N" figure
// against /api/nodes. The home page no longer carries a totals card, so that
// check has nothing to hang off; the figures it did show now come from
// /api/stats/progress via app/composables/stats/useStats.ts.
test.describe("Home", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  });

  test("displays at least four cards", async ({ page }) => {
    await expect
      .poll(() => page.locator(".v-card").count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(4);
  });

  // „Przeglądaj osoby” and its two cards are gone, so the queue is reached from
  // the call to action now. The table has no card of its own on the home page
  // any more - the search box's „Lista wszystkich osób” is its entry point, and
  // that belongs to OmniSearch's own specs.
  test("the call to action leads to the queue", async ({ page }) => {
    const cta = page
      .getByTestId("home-help-cta")
      .getByRole("link", { name: "Sprawdź pierwszą osobę" });
    await expect(cta).toHaveAttribute("href", "/eksploruj/nowe");

    // The link is in the markup before Vue attaches its router link, so an
    // early click navigates nowhere. Retry until one takes.
    await expect(async () => {
      await cta.click();
      await page.waitForURL(/\/eksploruj\/nowe/, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
  });

  test("the call to action leads to pomoc", async ({ page }) => {
    // By testid, not by accessible name: „Działaj z nami” is also the app bar's
    // label, `.first()` is DOM order, and the app bar comes first - so this was
    // green for anything the home page itself did with the button.
    const cta = page.getByTestId("home-cta");
    await expect(cta).toHaveAttribute("href", "/pomoc");

    await expect(async () => {
      await cta.click();
      await page.waitForURL(/\/pomoc/, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
  });

  test("the search fills most of its line on a desktop", async ({ page }) => {
    // Measured off the DOM rather than left to the page screenshot: the field
    // is one band across a tall fullPage capture, so widening it by 300px sits
    // under the 1% maxDiffPixelRatio the visual project allows and the
    // baseline goes on passing either way.
    //
    // The number this guards is a proportion, not a width. Capped at 400px the
    // search stopped a third of the way across and "Działaj z nami", which the
    // row exists to keep beside it, started near the middle of an empty line,
    // reading as a control that had come loose.
    const field = page.locator(".home-actions .v-input").first();
    await expect(field).toBeVisible({ timeout: 30_000 });

    const ratio = await field.evaluate((el) => {
      const line = el.closest(".home-actions")!;
      const style = getComputedStyle(line);
      const inner =
        line.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      return el.getBoundingClientRect().width / inner;
    });

    expect(ratio).toBeGreaterThan(0.5);
  });
});
