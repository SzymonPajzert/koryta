import { test, expect } from "@playwright/test";

test.describe("OmniSearch Nowe", () => {
  test("allows searching for person from /eksploruj/nowe", async ({ page }) => {
    // 1. Go to login page
    await page.goto("/login");

    // Wait for Vue hydration to complete before interacting
    await page.waitForTimeout(1500);

    // 2. Switch to register mode
    await page
      .locator("text=Nie masz konta? Zarejestruj się")
      .click({ force: true });

    // 3. Fill credentials
    const timestamp = Date.now();
    await page.locator("input#email").fill(`testuser${timestamp}@example.com`);
    await page.locator("input#password").fill("password123");

    // Handle the alert window that says "Wysłano email weryfikacyjny"
    page.on("dialog", (dialog) => dialog.accept());

    // 4. Submit registration
    await page.locator('button[type="submit"]').click({ force: true });

    // Give it a moment to authenticate and navigate, then forcefully go to /eksploruj/nowe
    await page.waitForTimeout(2000);
    await page.goto("/eksploruj/nowe");

    // Wait for hydration
    await expect(page.locator(".v-main")).toBeVisible();
    await page.waitForTimeout(500);

    // Click the search input
    await page.locator("input#omni-search").click();

    // Type 'grzyb' to search for Andrzej Grzyb
    await page.locator("input#omni-search").fill("grzyb");

    // Wait for search results
    const personItem = page
      .locator(".v-list-item", { hasText: "Andrzej Grzyb" })
      .first();
    await expect(personItem).toBeVisible();

    // Click Andrzej Grzyb
    await personItem.click();

    // Ensure the URL changed to the person's page
    await expect(page).toHaveURL(/.*\/osoba\/andrzej-grzyb.*/);
  });
});
