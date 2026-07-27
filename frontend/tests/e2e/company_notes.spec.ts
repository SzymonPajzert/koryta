import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";

/** KRS of the company seeded for the emulator, so this also runs on seed data. */
const COMPANY_KRS = "0000357114";
const COMPANY_VIEW = `/eksploruj/tabela?krs=${COMPANY_KRS}`;

test.describe("Company notes", () => {
  test("lets a logged in user add a source to a company", async ({ page }) => {
    test.setTimeout(90000); // Logs in, saves a note and revisits the page

    await page.goto(`/login?redirect=${encodeURIComponent(COMPANY_VIEW)}`);
    await waitForLoginFormHydrated(page);

    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });

    await page.waitForURL("**/eksploruj/tabela**", { timeout: 15000 });

    const companyCard = page.locator(`.v-card:has-text("${COMPANY_KRS}")`);
    await expect(companyCard).toBeVisible({ timeout: 15000 });

    // The prompt is company specific, not the person wording reused
    await expect(companyCard).toContainText("na temat tej spółki");

    await companyCard.getByRole("button", { name: "Dodaj źródło" }).click();

    // A fresh source starts without a url, behind a "Dodaj URL" chip
    const url = `https://example.com/spolka-${Date.now()}`;
    await companyCard.getByText("Dodaj URL").click();
    await companyCard.getByLabel("URL").fill(url);

    await companyCard.getByRole("button", { name: "Zapisz" }).click();

    // Saving hides the edit controls and the source stays on the card
    await expect(
      companyCard.getByRole("button", { name: "Zapisz" }),
    ).toBeHidden({ timeout: 15000 });
    await expect(companyCard).toContainText(url);

    // The note is attached to the company, so it is there on a fresh visit
    // The dev server keeps live listeners open, so "load" never settles here
    await page.goto(COMPANY_VIEW, { waitUntil: "domcontentloaded" });
    await expect(companyCard).toContainText(url, { timeout: 30000 });
  });
});
