import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";

/** KRS of the company seeded for the emulator, so this also runs on seed data.
 *
 * The table filters on node ids now, which differ between the seed and prod;
 * the KRS number is the identifier both share, so the view is opened by the
 * legacy `krs` parameter and rewritten to `place` once the places load. */
const COMPANY_KRS = "0000357114";
const COMPANY_VIEW = `/eksploruj/tabela?krs=${COMPANY_KRS}`;

test.describe("Company notes", () => {
  test("lets a logged in user add a source to a company", async ({ page }) => {
    test.setTimeout(180_000); // Logs in, saves a note and waits out a Cloud Function

    await page.goto(`/login?redirect=${encodeURIComponent(COMPANY_VIEW)}`);
    await waitForLoginFormHydrated(page);

    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });

    await page.waitForURL("**/eksploruj/tabela**", { timeout: 15000 });

    const companyCard = page.locator(`.v-card:has-text("${COMPANY_KRS}")`);
    await expect(companyCard).toBeVisible({ timeout: 15000 });

    // The seat comes from the region -> company owns edge, not the company node
    await expect(companyCard).toContainText("Województwo Pomorskie");

    // The notes are behind a button, so the card stays a compact strip
    await expect(companyCard).not.toContainText("na temat tej spółki");
    await companyCard.getByRole("button", { name: "Notatki" }).click();

    // The prompt is company specific, not the person wording reused
    await expect(companyCard).toContainText("na temat tej spółki");

    await companyCard.getByRole("button", { name: "Dodaj źródło" }).click();

    // A fresh source starts without a url, behind a "Dodaj URL" chip
    const url = `https://example.com/spolka-${Date.now()}`;
    await companyCard.getByText("Dodaj URL").click();
    await companyCard.getByLabel("URL").fill(url);

    await companyCard.getByRole("button", { name: "Zapisz" }).click();

    // Saving hides the edit controls and the source stays on the card. By
    // href, not by text: a saved entry is labelled with its host now
    // ("example.com"), because a cited url is routinely 120 characters and
    // printing it whole is what cut the source off mid-path on a phone.
    await expect(
      companyCard.getByRole("button", { name: "Zapisz" }),
    ).toBeHidden({ timeout: 15000 });
    await expect(companyCard.locator(`a[href="${url}"]`)).toBeVisible();

    // The note is attached to the company, so it is there on a fresh visit -
    // once onNoteWritten has folded it into the company. That is a Cloud
    // Function firing on a write with no event to wait for from here, so the
    // whole revisit is what gets retried rather than the assertion alone: a
    // page loaded too early shows the notes panel with no sources in it, and
    // waiting on that one longer will not make the note appear.
    // "load" never settles here, the app keeps live listeners open.
    await expect(async () => {
      await page.goto(COMPANY_VIEW, { waitUntil: "domcontentloaded" });
      await companyCard
        .getByRole("button", { name: "Notatki" })
        .click({ timeout: 30000 });
      await expect(companyCard.locator(`a[href="${url}"]`)).toBeVisible({
        timeout: 5000,
      });
    }).toPass({ timeout: 90_000 });
  });
});
