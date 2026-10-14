import { test, expect } from "./test";
import { pageTag } from "./pageTags";

/** /zrodla's "Na czym opiera się ta strona", opened.
 *
 * Kept out of pages.spec.ts because the panel is folded until a reader clicks
 * it, so the page's own baseline shows one line of it: the disclaimer and the
 * credits the open data licences ask for (CC BY 4.0 - who made each set, what
 * it is called, where it lives) were in no shot at all. Captured as the panel
 * alone rather than the page, so the articles table below it does not make
 * this baseline move whenever the seed's articles do.
 */
test(
  "zrodla-na-czym-opiera-sie",
  { tag: pageTag("zrodla") },
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/zrodla");

    const panel = page.locator(".v-expansion-panels");
    const licence = panel.getByRole("link", { name: "CC BY 4.0" });
    // Retried as a whole: until the page has hydrated, clicking the title opens
    // nothing.
    await expect(async () => {
      await panel.getByText("Na czym opiera się ta strona").click();
      await expect(licence).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(panel.getByRole("listitem")).toHaveCount(3);
    // The panel's height transition holds it at a whole number of pixels until
    // it ends - see ./fullPage.ts.
    await expect(
      page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
    ).toHaveCount(0);
    // On a phone the open panel is taller than the window, so the shot scrolls
    // and the fixed app bar lands across its title, the feedback launcher
    // across its first source. Neither is part of the panel: hidden, as in
    // ./home-cta.spec.ts, rather than masked into magenta blocks.
    await page.addStyleTag({
      content: ".v-app-bar, .feedback-fab { visibility: hidden !important; }",
    });
    await page.evaluate(() => document.fonts.ready);

    await expect(panel).toHaveScreenshot("zrodla-na-czym-opiera-sie.png");
  },
);
