import { test, expect } from "@playwright/test";

/** The home explorer's second panel.
 *
 * `home.png` captures the page as it loads, which is always the map tab, so
 * the „Partie" panel and the card beside it have never been photographed. That
 * card is mounted in both panels and only recently learned to say something
 * different in each - on the party treemap it used to ask the reader to pick a
 * region from a map that is not on the screen.
 *
 * The card and the tab strip, not the treemap: the chart is an ApexCharts
 * render whose cell labels shift with the width it is given, and the point
 * here is the words beside it.
 */

test.describe("Strona główna - eksplorator", () => {
  test("eksplorator-partie", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");

    // By its heading rather than a testid: the card carries none, and its
    // heading is the thing under test - it is what changes with the panel.
    const card = page
      .locator(".v-card")
      .filter({ hasText: "Analizuj powiązania" })
      .first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    // Two tab strips exist - one for phones above the panel, one for wider
    // screens above the card - and only one is displayed at a time, so `.last()`
    // would pick the hidden one on a phone. Clicking the visible one is what
    // the reader does.
    await page
      .getByRole("tab", { name: "Partie" })
      .locator("visible=true")
      .click();

    const parties = page
      .locator(".v-card")
      .filter({ hasText: "Przejdź do tabeli" })
      .first();
    await expect(parties).toBeVisible({ timeout: 30_000 });
    // The wording that made this shot worth taking: it must name the chart,
    // not the map.
    // `.first()`: the card carries both wordings and hides one with a
    // breakpoint class, so both are in the DOM at either viewport - "po lewej
    // stronie" for a wide screen and "na górze" for a phone.
    await expect(
      parties.getByText(/Kliknij partię na wykresie/).first(),
    ).toBeAttached({ timeout: 10_000 });

    await page.evaluate(() => document.fonts.ready);
    await expect(parties).toHaveScreenshot("eksplorator-partie.png");
  });
});
